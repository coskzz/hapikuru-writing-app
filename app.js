(() => {
  "use strict";

  const MODULE_ID = "writing";
  const LOCAL_USERS_KEY = "hapikuru.writing.localUsers.v1";
  const LOCAL_CURRENT_KEY = "hapikuru.writing.currentUser.v1";
  const LOCAL_DATA_PREFIX = "hapikuru.writing.data.v1.";
  const LOCAL_REPORTS_KEY = "hapikuru.writing.reports.v1";
  const STEPS = ["ja", "jaReview", "en", "result"];
  const POINTS_PER_ESSAY = 10;
  const HISTORY_MAX = 300;
  // 先生に質問するLINE（ハピクル英語塾の公式アカウント）。文面は渡せないので、押したときに質問用の文をコピーしてから開く
  const LINE_URL = "https://lin.ee/q1RMWbS";

  const TOPICS = window.WRITING_TOPICS || [];
  const PHRASES = window.WRITING_PHRASES || [];
  const SCORING = window.WRITING_SCORING || [];
  const MODEL = window.WRITING_MODEL_ANSWER || null;
  const EXAMPLE = window.WRITING_EXAMPLE || null;
  const VIDEOS = window.WRITING_VIDEOS || {};
  const AI_URL = String(window.WRITING_AI_URL || "").replace(/\/$/, "");
  // 試験用：?ai=local で開いたときは、同じ窓口（この PC の Codex。ローカルAIテスト/server.mjs）に添削させる
  const LOCAL_AI = new URLSearchParams(window.location.search).get("ai") === "local";

  const SENTENCE_ROLES = [
    "1文目：理由（言いたいこと）",
    "2文目：具体例・根拠（たとえば〜）",
    "3文目：まとめ・今の問題（だから／しかし〜）"
  ];
  const JA_PLACEHOLDERS = [
    ["例：日本の高校のカリキュラムは、生徒の力を伸ばすのに向いていない。", "例：たとえば、ある大学の研究では、先生とやり取りすることが一番力を伸ばすとわかった。", "例：しかし、今の日本の授業は、講義と暗記ばかりになっている。"],
    ["例：グローバルな社会では、英語を話す力を伸ばす必要がある。", "例：たとえば、私の経験では、ほとんどの生徒は授業で英文を読むだけで、話す練習をしていない。", "例：このままでは、生徒はいつまでたっても英語を話せるようにならない。"]
  ];
  const EN_PLACEHOLDERS = [
    ["Firstly, ...", "例：..., for example, shows that ...", "例：However, ..."],
    ["Additionally, ...", "例：In my experience, for instance, ...", "例：In this system, ..."]
  ];

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));

  let auth = null;
  let db = null;
  let firebaseReady = false;
  let localMode = false;
  let secondaryApp = null;

  let currentUser = null;
  let currentProfile = null;
  let records = [];
  let moduleState = emptyModuleState();
  let editing = null;
  let recordBack = "screen-stats";
  let pendingLoginError = "";
  let toastTimer = null;

  // 管理画面
  let adminStudentsAll = [];
  let adminStudentsMap = {};
  let adminTeachersAll = [];
  let adminTeachersMap = {};
  let adminView = { archive: "active", showInactive: false, sortKey: "updated", sortDir: -1, query: "" };
  let adminMode = "essay";
  let detailUid = null;
  let detailType = "student";
  let detailTab = "calendar";
  let detailRecords = [];
  let adminCalViewDate = new Date();
  let statsCalViewDate = new Date();
  let historyFilter = { detail: "all", stats: "all" };

  document.addEventListener("DOMContentLoaded", init);

  // ===== 起動 =====
  async function init() {
    bindStaticEvents();
    renderTutorial();
    setupTutorialVideo();
    renderPhraseList("");
    initFirebase();

    if (firebaseReady) {
      auth.onAuthStateChanged(async (user) => {
        if (localMode) return;
        if (!user) {
          resetSession();
          showScreen("screen-welcome");
          if (pendingLoginError) {
            showError("login-error", pendingLoginError);
            pendingLoginError = "";
          }
          return;
        }
        try {
          currentUser = user;
          await loadFirebaseData(user.uid);
          // 削除（アーカイブ）された生徒はログインできない（単語アプリと同じ）
          if (!isStaff() && currentProfile.archived) {
            pendingLoginError = "このアカウントは今は使えません。先生に連絡してください。";
            await auth.signOut();
            return;
          }
          afterLogin();
        } catch (error) {
          console.error(error);
          pendingLoginError = "データを読み込めませんでした。通信状態を確認して、もう一度ログインしてください。";
          await auth.signOut();
        }
      });
    } else {
      localMode = true;
      restoreLocalSession();
    }
  }

  function initFirebase() {
    try {
      if (typeof firebase === "undefined" || typeof firebaseConfig === "undefined") return;
      firebase.initializeApp(firebaseConfig);
      auth = firebase.auth();
      db = firebase.firestore();
      firebaseReady = true;
    } catch (error) {
      console.warn("Firebase initialization skipped:", error);
      firebaseReady = false;
    }
  }

  function getSecondaryApp() {
    if (secondaryApp) return secondaryApp;
    secondaryApp = firebase.initializeApp(firebaseConfig, "secondary");
    return secondaryApp;
  }

  function bindStaticEvents() {
    $("#show-signup").addEventListener("click", () => toggleAuthForm("signup"));
    $("#show-login").addEventListener("click", () => toggleAuthForm("login"));
    $("#btn-login").addEventListener("click", handleLogin);
    $("#btn-signup").addEventListener("click", handleSignup);
    $("#btn-demo-login").addEventListener("click", startDemo);
    $("#btn-logout").addEventListener("click", handleLogout);
    $("#btn-admin-logout").addEventListener("click", handleLogout);
    $("#btn-finish-tutorial").addEventListener("click", finishTutorial);
    $("#btn-resume").addEventListener("click", () => {
      const draft = latestDraft();
      if (draft) openEditor(draft);
    });
    $("#btn-write-back").addEventListener("click", leaveEditor);
    $("#btn-record-back").addEventListener("click", backFromRecord);
    $("#phrase-search").addEventListener("input", (event) => renderPhraseList(event.target.value));
    $("#topic-search").addEventListener("input", renderHome);

    ["#login-id", "#login-password"].forEach((selector) => {
      $(selector).addEventListener("keydown", (event) => {
        if (event.key === "Enter") handleLogin();
      });
    });

    $$(".mode-tab").forEach((button) => {
      button.addEventListener("click", () => {
        const mode = button.dataset.mode;
        $$(".mode-tab").forEach((tab) => tab.classList.toggle("active", tab === button));
        $("#mode-essay").classList.toggle("hidden", mode !== "essay");
        $("#mode-summary").classList.toggle("hidden", mode !== "summary");
      });
    });

    $$(".tab-btn").forEach((button) => {
      button.addEventListener("click", () => goToScreen(button.dataset.tabScreen));
    });

    // 学習データの英作文／要約
    $$("[data-stats-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        $$("[data-stats-mode]").forEach((tab) => tab.classList.toggle("active", tab === button));
        $("#stats-essay").classList.toggle("hidden", button.dataset.statsMode !== "essay");
        $("#stats-summary").classList.toggle("hidden", button.dataset.statsMode !== "summary");
      });
    });

    // マイページ
    $("#btn-edit-name").addEventListener("click", () => {
      $("#edit-name-input").value = currentProfile?.name || "";
      $("#profile-name-display").classList.add("hidden");
      $("#profile-name-edit").classList.remove("hidden");
    });
    $("#btn-cancel-name").addEventListener("click", () => {
      $("#profile-name-display").classList.remove("hidden");
      $("#profile-name-edit").classList.add("hidden");
    });
    $("#btn-save-name").addEventListener("click", saveName);
    $("#btn-edit-id").addEventListener("click", openEditIdModal);
    $("#btn-submit-edit-id").addEventListener("click", submitEditId);
    $("#btn-report-general").addEventListener("click", openReport);
    $("#btn-submit-report").addEventListener("click", submitReport);
    $("#report-message").addEventListener("input", updateReportCount);
    $("#report-type-group").addEventListener("click", (event) => {
      const button = event.target.closest(".report-type-btn");
      if (!button) return;
      $$(".report-type-btn").forEach((item) => item.classList.toggle("active", item === button));
    });
    $("#btn-reset").addEventListener("click", resetLearningData);

    // 管理画面
    $$("[data-admin-tab]").forEach((button) => button.addEventListener("click", () => switchAdminTab(button.dataset.adminTab)));
    $$("[data-admin-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        adminMode = button.dataset.adminMode;
        $$("[data-admin-mode]").forEach((item) => item.classList.toggle("active", item === button));
        renderAdminStudents();
      });
    });
    $("#btn-admin-refresh").addEventListener("click", loadAdminStudents);
    $("#admin-search").addEventListener("input", (event) => {
      adminView.query = event.target.value.trim().toLowerCase();
      renderAdminStudents();
    });
    $$("#admin-archive-chips .chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        adminView.archive = chip.dataset.archive;
        $$("#admin-archive-chips .chip").forEach((item) => item.classList.toggle("active", item === chip));
        renderAdminStudents();
      });
    });
    $("#admin-show-inactive").addEventListener("change", (event) => {
      adminView.showInactive = event.target.checked;
      renderAdminStudents();
    });
    $("#btn-admin-teachers-refresh").addEventListener("click", loadAdminTeachers);
    $("#admin-teacher-search").addEventListener("input", renderAdminTeachers);
    $("#btn-create-teacher").addEventListener("click", createTeacher);
    $("#admin-topic-search").addEventListener("input", renderAdminTopics);
    $("#btn-pw-toggle").addEventListener("click", toggleDetailPw);
    $$("[data-detail-tab]").forEach((button) => button.addEventListener("click", () => renderDetailTab(button.dataset.detailTab)));

    $$(".back-btn[data-back]").forEach((button) => {
      button.addEventListener("click", () => showScreen(button.dataset.back));
    });

    // 画面の中で作る部品は、まとめてここで受ける
    document.addEventListener("click", (event) => {
      const target = event.target;
      if (handlePhraseClick(target)) return;
      if (target.closest("[data-open-phrases]")) openModal("phrases-modal");
      if (target.closest("[data-open-tutorial]")) openModal("tutorial-modal");
      const videoButton = target.closest("[data-open-video]");
      if (videoButton) openVideo(videoButton.dataset.openVideo);
      const close = target.closest("[data-close-modal]");
      if (close) closeModal(close.dataset.closeModal);
      if (target.classList && target.classList.contains("modal-overlay")) closeModal(target.id);
      const go = target.closest("[data-go]");
      if (go) {
        event.preventDefault();
        goToScreen(go.dataset.go);
      }
      const sort = target.closest("[data-sort]");
      if (sort) adminSort(sort.dataset.sort);
      const act = target.closest("[data-admin-action]");
      if (act) adminAction(act.dataset.adminAction, act.dataset.uid);
      const openUser = target.closest("[data-open-user]");
      if (openUser) openUserDetail(openUser.dataset.openUser, openUser.dataset.userType || "student");
      const pw = target.closest("[data-inline-pw]");
      if (pw) toggleInlinePw(pw);
      const cal = target.closest("[data-cal-nav]");
      if (cal) calNavMonth(Number(cal.dataset.calNav), cal.dataset.calTarget);
      const hf = target.closest("[data-history-filter]");
      if (hf) setHistoryFilter(hf.dataset.historyTarget, hf.dataset.historyFilter);
      const rec = target.closest("[data-record]");
      if (rec) openRecordFromList(rec.dataset.record, rec.dataset.recordScope || "own");
    });
  }

  function goToScreen(screen) {
    if (!screen) return;
    if (screen === "screen-home") {
      showScreen("screen-home");
      renderHome();
    } else if (screen === "screen-stats") {
      openStats();
    } else if (screen === "screen-mypage") {
      openMyPage();
    } else if (screen === "screen-phrase-home") {
      openPhraseHome();
    } else if (screen === "screen-admin") {
      showScreen("screen-admin");
      switchAdminTab("students");
    } else {
      showScreen(screen);
    }
  }

  // ===== ログイン（単語アプリと同じ方式） =====
  function toggleAuthForm(mode) {
    $("#form-login").classList.toggle("hidden", mode !== "login");
    $("#form-signup").classList.toggle("hidden", mode !== "signup");
    clearError("login-error");
    clearError("signup-error");
  }

  function idToEmail(id) {
    return id.toLowerCase().replace(/\s+/g, "_") + "@hapikuru.local";
  }

  function resolveLoginEmail(input) {
    const trimmed = (input || "").trim();
    if (trimmed.includes("@")) return trimmed.toLowerCase();
    return idToEmail(trimmed);
  }

  function authErrorMsg(code) {
    const map = {
      "auth/user-not-found": "IDが見つかりません。",
      "auth/wrong-password": "パスワードが間違っています。",
      "auth/invalid-credential": "IDまたはパスワードが正しくありません。",
      "auth/email-already-in-use": "このIDはすでに使用されています。",
      "auth/invalid-email": "IDの形式が正しくありません。",
      "auth/weak-password": "パスワードは6文字以上で設定してください。",
      "auth/too-many-requests": "ログイン試行回数が多すぎます。しばらく待ってから試してください。"
    };
    return map[code] || `エラーが発生しました（${code}）`;
  }

  function permissionMessage(error) {
    if (error && (error.code === "permission-denied" || /permission/i.test(error.message || ""))) {
      return "保存できませんでした。データベースの設定（ルール）で止まっています。単語アプリの管理画面でも同じ状態です。";
    }
    return `エラー: ${error && (error.message || error.code) || error}`;
  }

  async function handleLogin() {
    const loginInput = $("#login-id").value.trim();
    const password = $("#login-password").value;
    clearError("login-error");
    if (!loginInput || !password) {
      showError("login-error", "IDとパスワードを入力してください。");
      return;
    }
    if (!firebaseReady) {
      loginLocal(loginInput, password);
      return;
    }
    localMode = false;
    const button = $("#btn-login");
    button.disabled = true;
    button.textContent = "...";
    try {
      await auth.signInWithEmailAndPassword(resolveLoginEmail(loginInput), password);
    } catch (error) {
      showError("login-error", authErrorMsg(error.code));
    } finally {
      button.disabled = false;
      button.textContent = "ログイン";
    }
  }

  async function handleSignup() {
    const name = $("#signup-name").value.trim();
    const userId = $("#signup-id").value.trim();
    const password = $("#signup-password").value;
    clearError("signup-error");
    if (!name) return showError("signup-error", "お名前を入力してください。");
    if (!userId) return showError("signup-error", "IDを入力してください。");
    if (password.length < 6) return showError("signup-error", "パスワードは6文字以上で入力してください。");
    if (!firebaseReady) {
      signupLocal(name, userId, password);
      return;
    }
    localMode = false;
    const button = $("#btn-signup");
    button.disabled = true;
    button.textContent = "...";
    try {
      const credential = await auth.createUserWithEmailAndPassword(idToEmail(userId), password);
      await db.collection("users").doc(credential.user.uid).set({
        name, userId, password, role: "student", records_ex: {}, records_pastan: {},
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (error) {
      showError("signup-error", authErrorMsg(error.code));
    } finally {
      button.disabled = false;
      button.textContent = "登録する";
    }
  }

  async function handleLogout() {
    closeModal("student-detail-modal");
    if (localMode || !firebaseReady) {
      localStorage.removeItem(LOCAL_CURRENT_KEY);
      localMode = false;
      resetSession();
      showScreen("screen-welcome");
      return;
    }
    await auth.signOut();
  }

  function resetSession() {
    currentUser = null;
    currentProfile = null;
    records = [];
    moduleState = emptyModuleState();
    editing = null;
  }

  async function loadFirebaseData(uid) {
    const profileSnap = await userDocRef(uid).get();
    const profile = profileSnap.exists ? profileSnap.data() : {};
    currentProfile = {
      uid,
      name: profile.name || "ハピクル生",
      userId: profile.userId || "",
      role: profile.role || "student",
      archived: profile.archived === true
    };
    moduleState = emptyModuleState();
    records = [];
    try {
      const [moduleSnap, recordsSnap] = await Promise.all([
        moduleDocRef(uid).get(),
        recordsColRef(uid).get()
      ]);
      if (moduleSnap.exists) moduleState = normalizeModuleState(moduleSnap.data());
      records = recordsSnap.docs.map((doc) => normalizeRecord({ id: doc.id, ...doc.data() }));
      sortRecords(records);
    } catch (error) {
      // ルールで記録が読めないときも、ログインと画面は使えるようにする
      console.warn("writing data not loaded", error);
      showToast("記録を読み込めませんでした（データベースの設定待ち）");
    }
  }

  function afterLogin() {
    $("#home-user-name").textContent = currentProfile?.name || "";
    $("#demo-badge").classList.toggle("hidden", !localMode && !LOCAL_AI);
    if (LOCAL_AI) $("#demo-badge").textContent = "試験：Codex";
    $("#tab-admin").classList.toggle("hidden", !isStaff());
    $("#admin-teacher-name").textContent = `講師: ${currentProfile?.name || ""}`;
    // 講師は管理画面から始まる（単語アプリと同じ）。デモは生徒の画面から
    if (isStaff() && !localMode) {
      goToScreen("screen-admin");
      return;
    }
    goToScreen("screen-home");
    if (!moduleState.tutorialDone) openModal("tutorial-modal");
  }

  function isStaff() {
    return ["teacher", "admin"].includes(currentProfile?.role);
  }

  // ===== デモ（この端末だけに保存・AIなし） =====
  function startDemo() {
    localMode = true;
    const users = getLocalUsers();
    users.local_demo = { ...(users.local_demo || {}), uid: "local_demo", name: "デモユーザー", userId: "demo", password: "demo123", role: "teacher" };
    if (!users.local_sample) {
      users.local_sample = { uid: "local_sample", name: "見本 花子", userId: "sample", password: "sample123", role: "student" };
    }
    setLocalUsers(users);
    currentUser = { uid: "local_demo" };
    currentProfile = users.local_demo;
    localStorage.setItem(LOCAL_CURRENT_KEY, "local_demo");
    loadLocalData("local_demo");
    afterLogin();
  }

  function loginLocal(inputId, password) {
    localMode = true;
    const users = getLocalUsers();
    const found = Object.values(users).find((user) => user.userId === inputId.trim() && user.password === password);
    if (!found) {
      showError("login-error", "サーバーにつながらないため、この端末のデモ用データだけ使えます。");
      return;
    }
    currentUser = { uid: found.uid };
    currentProfile = found;
    localStorage.setItem(LOCAL_CURRENT_KEY, found.uid);
    loadLocalData(found.uid);
    afterLogin();
  }

  function signupLocal(name, userId, password) {
    localMode = true;
    const users = getLocalUsers();
    const uid = `local_${userId}`;
    users[uid] = { uid, name, userId, password, role: "student" };
    setLocalUsers(users);
    currentUser = { uid };
    currentProfile = users[uid];
    localStorage.setItem(LOCAL_CURRENT_KEY, uid);
    loadLocalData(uid);
    afterLogin();
  }

  function restoreLocalSession() {
    const uid = localStorage.getItem(LOCAL_CURRENT_KEY);
    const profile = uid ? getLocalUsers()[uid] : null;
    if (!profile) {
      showScreen("screen-welcome");
      return;
    }
    currentUser = { uid };
    currentProfile = profile;
    loadLocalData(uid);
    afterLogin();
  }

  function getLocalUsers() {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_USERS_KEY) || "{}");
    } catch (error) {
      return {};
    }
  }

  function setLocalUsers(users) {
    localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users));
  }

  function readLocalData(uid) {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_DATA_PREFIX + uid) || "{}");
    } catch (error) {
      return {};
    }
  }

  function loadLocalData(uid) {
    const data = readLocalData(uid);
    records = (data.records || []).map(normalizeRecord);
    sortRecords(records);
    moduleState = normalizeModuleState(data.moduleState || {});
  }

  function saveLocalData() {
    const data = readLocalData(currentUser.uid);
    data.records = records;
    data.moduleState = moduleState;
    localStorage.setItem(LOCAL_DATA_PREFIX + currentUser.uid, JSON.stringify(data));
  }

  // ===== 保存（Firestore：users/{uid}/modules/writing/...） =====
  function userDocRef(uid) {
    return db.collection("users").doc(uid);
  }

  function moduleDocRef(uid) {
    return userDocRef(uid).collection("modules").doc(MODULE_ID);
  }

  function recordsColRef(uid) {
    return moduleDocRef(uid).collection("records");
  }

  function emptyModuleState() {
    return { tutorialDone: false, points: 0, dailyLog: {}, historyLog: [], lastActivityAt: "", lastTopicLabel: "", phrase: emptyPhraseState() };
  }

  function normalizeModuleState(input) {
    return {
      tutorialDone: Boolean(input.tutorialDone),
      points: Number(input.points || 0),
      dailyLog: input.dailyLog && typeof input.dailyLog === "object" ? input.dailyLog : {},
      historyLog: Array.isArray(input.historyLog) ? input.historyLog : [],
      lastActivityAt: input.lastActivityAt || "",
      lastTopicLabel: input.lastTopicLabel || "",
      essayCount: Number(input.essayCount || 0),
      essayDraftCount: Number(input.essayDraftCount || 0),
      phrase: normalizePhraseState(input.phrase)
    };
  }

  // モジュールの書類（題数・1日ごとの記録・履歴・ポイント）。管理画面の一覧はここだけを読む
  function modulePayload() {
    return {
      moduleId: MODULE_ID,
      tutorialDone: moduleState.tutorialDone,
      essayCount: records.filter((item) => item.status === "done").length,
      essayDraftCount: records.filter((item) => item.status !== "done").length,
      summaryCount: 0,
      points: moduleState.points,
      dailyLog: moduleState.dailyLog,
      historyLog: moduleState.historyLog.slice(0, HISTORY_MAX),
      lastActivityAt: moduleState.lastActivityAt,
      lastTopicLabel: moduleState.lastTopicLabel,
      phrase: moduleState.phrase
    };
  }

  async function persistModule() {
    if (localMode) {
      saveLocalData();
      return;
    }
    await moduleDocRef(currentUser.uid).set({ ...modulePayload(), updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
  }

  async function persistRecord(record) {
    record.updatedAt = new Date().toISOString();
    const index = records.findIndex((item) => item.id === record.id);
    if (index >= 0) records[index] = record;
    else records.unshift(record);
    sortRecords(records);
    moduleState.lastActivityAt = record.updatedAt;
    moduleState.lastTopicLabel = record.topic.label || "";

    if (localMode) {
      saveLocalData();
      return;
    }
    await recordsColRef(currentUser.uid).doc(record.id).set(toFirestore(record));
    await persistModule();
  }

  async function removeRecord(record) {
    records = records.filter((item) => item.id !== record.id);
    if (localMode) {
      saveLocalData();
      return;
    }
    await recordsColRef(currentUser.uid).doc(record.id).delete();
    await persistModule();
  }

  // 学習の記録（1日ごとの回数・履歴・ポイント）。type: "ja"＝日本語の添削／"done"＝全文ができた
  async function logActivity(type, record) {
    const now = new Date();
    const day = dateKey(now);
    const entry = moduleState.dailyLog[day] || { ja: 0, done: 0, words: 0 };
    if (type === "ja") entry.ja = (entry.ja || 0) + 1;
    if (type === "done") {
      entry.done = (entry.done || 0) + 1;
      entry.words = (entry.words || 0) + (record.essay?.wordCount || 0);
      moduleState.points += POINTS_PER_ESSAY;
    }
    moduleState.dailyLog[day] = entry;
    moduleState.historyLog.unshift({
      at: now.toISOString(),
      type,
      topicId: record.topicId,
      label: record.topic.label || "",
      topicEn: record.topic.en || "",
      words: type === "done" ? (record.essay?.wordCount || 0) : 0
    });
    moduleState.historyLog = moduleState.historyLog.slice(0, HISTORY_MAX);
    moduleState.lastActivityAt = now.toISOString();
    moduleState.lastTopicLabel = record.topic.label || "";
    try {
      await persistModule();
      if (type === "done" && !localMode) await recordCommonActivity();
    } catch (error) {
      console.warn("activity not saved", error);
    }
  }

  // 共通仕様 v1 の横串（アプリ横断の学習日・ポイント）
  async function recordCommonActivity() {
    const uid = currentUser.uid;
    const date = dateKey(new Date());
    const FieldValue = firebase.firestore.FieldValue;
    await Promise.all([
      userDocRef(uid).collection("streaks").doc(date).set({
        date, modules: FieldValue.arrayUnion(MODULE_ID), updatedAt: FieldValue.serverTimestamp()
      }, { merge: true }),
      userDocRef(uid).collection("points").doc("summary").set({
        total: FieldValue.increment(POINTS_PER_ESSAY), updatedAt: FieldValue.serverTimestamp()
      }, { merge: true })
    ]).catch((error) => console.warn("common activity not saved", error));
  }

  async function finishTutorial() {
    closeModal("tutorial-modal");
    $("#tutorial-video").pause();
    if (moduleState.tutorialDone) return;
    moduleState.tutorialDone = true;
    await persistModule().catch(() => {});
  }

  function toFirestore(record) {
    return JSON.parse(JSON.stringify(record));
  }

  // ===== 記録の形 =====
  function newRecord(topic) {
    const now = new Date().toISOString();
    return {
      id: `${now.replace(/[-:.TZ]/g, "").slice(0, 14)}_${Math.random().toString(36).slice(2, 7)}`,
      kind: "essay",
      topicId: topic.id,
      topic: { id: topic.id, label: topic.label, en: topic.en, ja: topic.ja, points: topic.points, pointsJa: topic.pointsJa || [] },
      stance: "",
      reasons: [emptyReason(), emptyReason()],
      jaReview: null,
      enReview: null,
      essay: null,
      step: "ja",
      status: "draft",
      createdAt: now,
      updatedAt: now
    };
  }

  function emptyReason() {
    return { point: "", ja: ["", "", ""], en: ["", "", ""] };
  }

  function normalizeRecord(input) {
    const record = { ...input };
    record.reasons = [0, 1].map((r) => {
      const reason = (input.reasons || [])[r] || {};
      return {
        point: reason.point || "",
        ja: [0, 1, 2].map((i) => (reason.ja || [])[i] || ""),
        en: [0, 1, 2].map((i) => (reason.en || [])[i] || "")
      };
    });
    record.step = STEPS.includes(input.step) ? input.step : "ja";
    record.status = input.status === "done" ? "done" : "draft";
    record.topic = input.topic || findTopic(input.topicId) || { en: "", ja: "", points: [] };
    return record;
  }

  function sortRecords(list) {
    list.sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
  }

  function findTopic(id) {
    if (EXAMPLE && id === EXAMPLE.topic.id) return EXAMPLE.topic;
    return TOPICS.find((topic) => topic.id === id) || null;
  }

  // 例題のカード（書くのいちばん上）。解き方の動画と、書いてみるボタン
  function exampleCardHtml() {
    if (!EXAMPLE) return "";
    const topic = EXAMPLE.topic;
    const mine = records.filter((record) => record.topicId === topic.id);
    const doneCount = mine.filter((record) => record.status === "done").length;
    const draft = mine.find((record) => record.status !== "done");
    const write = draft
      ? `<button class="btn btn-primary btn-small" data-resume="${escapeAttr(draft.id)}">続きから</button>`
      : `<button class="btn btn-primary btn-small" data-start="${escapeAttr(topic.id)}">書いてみる</button>`;
    return `
      <article class="topic-card example-card">
        <div class="topic-card-head">
          <span class="example-badge">例題</span>
          ${doneCount ? `<span class="badge badge-done">完了 ${doneCount}回</span>` : ""}
          ${draft ? `<span class="badge badge-draft">書きかけ</span>` : ""}
        </div>
        <h3>${escapeHtml(topic.en)}</h3>
        <p class="topic-ja">${escapeHtml(topic.ja)}</p>
        <p class="topic-points">POINTS：${topic.points.map(escapeHtml).join(" / ")}</p>
        <p class="example-note">まずはこの例題で、解き方を動画で見てから書いてみよう。</p>
        <div class="topic-actions">
          <button class="btn btn-secondary btn-small" data-example-video>▶ 解き方の動画</button>
          ${write}
        </div>
      </article>`;
  }

  function openVideo(key) {
    const item = VIDEOS[key];
    if (!item) {
      showToast("解き方の動画は準備中です");
      return;
    }
    const video = $("#video-player");
    if (video.getAttribute("src") !== item.src) {
      video.src = item.src;
      video.poster = item.poster || "";
    }
    $("#video-modal .modal-title").textContent = item.title || "▶ 動画";
    openModal("video-modal");
    video.play().catch(() => {});
  }

  // 使い方の動画（動画1）を使い方の画面に入れる
  function setupTutorialVideo() {
    const item = VIDEOS.intro;
    const video = $("#tutorial-video");
    if (!item) {
      video.classList.add("hidden");
      $(".tutorial-text").open = true;
      return;
    }
    video.src = item.src;
    video.poster = item.poster || "";
  }

  function latestDraft() {
    return records.find((record) => record.status !== "done") || null;
  }

  // ===== ホーム =====
  function renderHome() {
    const draft = latestDraft();
    $("#resume-panel").classList.toggle("hidden", !draft);
    if (draft) {
      $("#resume-title").textContent = draft.topic.en;
      $("#resume-copy").textContent = `${draft.topic.label || ""}　${stepLabel(draft.step)}の途中`;
    }

    const query = ($("#topic-search").value || "").trim().toLowerCase();
    const shown = TOPICS.filter((topic) => !query || `${topic.label} ${topic.en} ${topic.ja} ${topic.points.join(" ")}`.toLowerCase().includes(query));
    const showExample = EXAMPLE && (!query || "例題".includes(query) || `${EXAMPLE.topic.en} ${EXAMPLE.topic.ja}`.toLowerCase().includes(query));
    const showPhrase = !query || ["フレーズを覚える", "暗記", "phrase"].some((word) => word.includes(query));
    $("#topic-list").innerHTML = (showPhrase ? phraseCardHtml() : "") + (showExample ? exampleCardHtml() : "") + (shown.length ? shown.map((topic) => {
      const mine = records.filter((record) => record.topicId === topic.id);
      const doneCount = mine.filter((record) => record.status === "done").length;
      const topicDraft = mine.find((record) => record.status !== "done");
      const badges = [
        doneCount ? `<span class="badge badge-done">完了 ${doneCount}回</span>` : "",
        topicDraft ? `<span class="badge badge-draft">書きかけ</span>` : ""
      ].join("");
      const actions = topicDraft
        ? `<button class="btn btn-primary btn-small" data-resume="${escapeAttr(topicDraft.id)}">続きから</button>
           <button class="btn btn-secondary btn-small" data-start="${escapeAttr(topic.id)}">最初から</button>`
        : `<button class="btn btn-primary btn-small" data-start="${escapeAttr(topic.id)}">書く</button>`;
      return `
        <article class="topic-card">
          <div class="topic-card-head">
            <span class="topic-label">${escapeHtml(topic.label)}</span>
            ${badges}
          </div>
          <h3>${escapeHtml(topic.en)}</h3>
          <p class="topic-ja">${escapeHtml(topic.ja)}</p>
          <p class="topic-points">POINTS：${topic.points.map(escapeHtml).join(" / ")}</p>
          <div class="topic-actions">${actions}</div>
        </article>`;
    }).join("") : `<p class="empty-panel">見つかりませんでした。</p>`);
    const exampleVideo = $("[data-example-video]");
    if (exampleVideo) exampleVideo.addEventListener("click", () => openVideo("example"));

    $$("[data-start]").forEach((button) => {
      button.addEventListener("click", () => {
        const topic = findTopic(button.dataset.start);
        if (!topic) return;
        const existing = records.find((record) => record.topicId === topic.id && record.status !== "done");
        if (existing && hasContent(existing) && !window.confirm("書きかけの内容は消えます。最初から書きますか？")) return;
        if (existing) removeRecord(existing).catch(() => {});
        openEditor(newRecord(topic));
      });
    });
    $$("[data-resume]").forEach((button) => {
      button.addEventListener("click", () => {
        const record = records.find((item) => item.id === button.dataset.resume);
        if (record) openEditor(record);
      });
    });
  }

  function hasContent(record) {
    return Boolean(record.stance) || record.reasons.some((reason) => reason.point || reason.ja.some(Boolean) || reason.en.some(Boolean));
  }

  // ===== 書く画面 =====
  function openEditor(record) {
    editing = JSON.parse(JSON.stringify(record));
    $("#write-label").textContent = editing.topic.label || "";
    $("#write-topic-en").textContent = editing.topic.en;
    $("#write-topic-ja").textContent = editing.topic.ja || "";
    showScreen("screen-write");
    renderEditor();
  }

  async function leaveEditor() {
    await closeEditor("screen-home");
  }

  // 書く画面を閉じるときは、書いた内容を必ず保存してから移る（保存に失敗した完成答案もここで拾う）
  async function closeEditor(target) {
    if (editing && hasContent(editing)) {
      try {
        await persistRecord(editing);
        if (editing.status !== "done") showToast("書きかけを保存しました");
      } catch (error) {
        console.error(error);
        showToast("保存できませんでした。通信状態を確認してください");
      }
    }
    editing = null;
    showScreen(target);
    if (target === "screen-home") renderHome();
    if (target === "screen-stats") openStats();
  }

  function renderEditor() {
    const step = editing.step;
    $$("#stepper li").forEach((item) => {
      const index = STEPS.indexOf(item.dataset.step);
      item.classList.toggle("active", item.dataset.step === step);
      item.classList.toggle("done", index < STEPS.indexOf(step));
    });
    const body = $("#write-body");
    if (step === "ja") body.innerHTML = renderJaStep();
    if (step === "jaReview") body.innerHTML = renderJaReviewStep();
    if (step === "en") body.innerHTML = renderEnStep();
    if (step === "result") body.innerHTML = renderResult(editing, { own: true });
    bindEditorEvents(step);
    $$("#write-body textarea").forEach((area) => {
      autoGrow(area);
      area.addEventListener("input", () => autoGrow(area));
    });
    window.scrollTo({ top: 0 });
  }

  function stanceLabels(topic) {
    const en = String(topic.en || "");
    if (/^agree or disagree/i.test(en)) return { agree: "賛成（Agree）", disagree: "反対（Disagree）" };
    return { agree: "賛成（Yes）", disagree: "反対（No）" };
  }

  function pointOptions(topic, selected) {
    const options = topic.points.map((point, i) => {
      const ja = (topic.pointsJa || [])[i];
      const label = ja ? `${point}（${ja}）` : point;
      return `<option value="${escapeAttr(point)}" ${point === selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
    });
    return `<option value="">POINTを選ぶ</option>${options.join("")}`;
  }

  function renderJaStep() {
    const labels = stanceLabels(editing.topic);
    const reasons = editing.reasons.map((reason, r) => `
      <section class="work-panel">
        <div class="reason-head">
          <h2>理由${r + 1}</h2>
          <select class="point-select" data-point="${r}" aria-label="理由${r + 1}のPOINT">${pointOptions(editing.topic, reason.point)}</select>
        </div>
        ${reason.ja.map((text, i) => `
          <label class="sentence-field">
            <span>${SENTENCE_ROLES[i]}</span>
            <textarea rows="3" data-ja="${r}-${i}" placeholder="${escapeAttr(JA_PLACEHOLDERS[r][i])}">${escapeHtml(text)}</textarea>
          </label>`).join("")}
      </section>`).join("");

    return `
      <section class="topic-box">
        <p class="topic-points">POINTS：${editing.topic.points.map(escapeHtml).join(" / ")}</p>
        <p class="hint">英検では、POINTSから2つ選んで理由にします。書くのは理由の部分（2・3段落目）だけ。1段落目と4段落目はアプリが作ります。</p>
      </section>
      <section class="work-panel">
        <h2>あなたの立場</h2>
        <div class="stance-row">
          <label class="stance-option"><input type="radio" name="stance" value="agree" ${editing.stance === "agree" ? "checked" : ""}> ${labels.agree}</label>
          <label class="stance-option"><input type="radio" name="stance" value="disagree" ${editing.stance === "disagree" ? "checked" : ""}> ${labels.disagree}</label>
        </div>
      </section>
      ${reasons}
      <p id="ja-error" class="form-error hidden"></p>
      <button id="btn-review-ja" class="btn btn-primary btn-wide">日本語を添削してもらう</button>`;
  }

  function renderJaReviewStep() {
    const review = editing.jaReview;
    if (!review) return "";
    const blocks = [0, 1].map((r) => `
      <section class="work-panel">
        <div class="reason-head"><h2>理由${r + 1}</h2><span class="badge">${escapeHtml(editing.reasons[r].point)}</span></div>
        ${review.sentences.filter((s) => s.reason === r + 1).map((s) => `
          <div class="review-item">
            <p class="review-role">${SENTENCE_ROLES[s.index - 1] || ""}</p>
            <p class="review-before"><span>あなたの日本語</span>${escapeHtml(s.original)}</p>
            <p class="review-after"><span>英語にしやすい日本語</span>${escapeHtml(s.revised)}</p>
            <p class="review-comment">${escapeHtml(s.comment)}</p>
            ${renderGrammarChips(s.grammar)}
            ${renderPhraseHint(s.phraseNo)}
          </div>`).join("")}
      </section>`).join("");
    return `
      ${review.overall ? `<section class="ai-note"><p class="panel-label">AIからのひとこと</p><p>${escapeHtml(review.overall)}</p></section>` : ""}
      ${blocks}
      <div class="button-row">
        <button id="btn-back-ja" class="btn btn-secondary">日本語を書き直す</button>
        <button id="btn-go-en" class="btn btn-primary">この日本語で英語にする</button>
      </div>`;
  }

  function renderEnStep() {
    const review = editing.jaReview;
    const blocks = [0, 1].map((r) => `
      <section class="work-panel">
        <div class="reason-head"><h2>理由${r + 1}</h2><span class="badge">${escapeHtml(editing.reasons[r].point)}</span></div>
        ${[0, 1, 2].map((i) => {
          const sentence = review ? review.sentences.find((s) => s.reason === r + 1 && s.index === i + 1) : null;
          return `
          <label class="sentence-field">
            <span>${SENTENCE_ROLES[i]}</span>
            <p class="ja-model">${escapeHtml(sentence ? sentence.revised : editing.reasons[r].ja[i])}</p>
            <textarea rows="3" lang="en" autocapitalize="sentences" data-en="${r}-${i}" placeholder="${escapeAttr(EN_PLACEHOLDERS[r][i])}">${escapeHtml(editing.reasons[r].en[i])}</textarea>
            ${sentence && sentence.phraseNo ? renderPhraseHint(sentence.phraseNo) : ""}
          </label>`;
        }).join("")}
      </section>`).join("");
    return `
      <section class="topic-box">
        <p class="hint">直った日本語を見ながら、6文を英語にしよう。理由1は Firstly,、理由2は Additionally, で始めるのが型。</p>
        <button class="text-btn" data-open-phrases>おすすめフレーズ77を見る</button>
      </section>
      ${blocks}
      <p id="en-error" class="form-error hidden"></p>
      <div class="button-row">
        <button id="btn-back-jareview" class="btn btn-secondary">日本語の添削に戻る</button>
        <button id="btn-review-en" class="btn btn-primary">送信して添削してもらう</button>
      </div>`;
  }

  function bindEditorEvents(step) {
    if (step === "ja") {
      $$("input[name=stance]").forEach((input) => input.addEventListener("change", () => { editing.stance = input.value; }));
      $$("[data-point]").forEach((select) => select.addEventListener("change", () => { editing.reasons[Number(select.dataset.point)].point = select.value; }));
      $$("[data-ja]").forEach((area) => area.addEventListener("input", () => {
        const [r, i] = area.dataset.ja.split("-").map(Number);
        editing.reasons[r].ja[i] = area.value;
      }));
      $("#btn-review-ja").addEventListener("click", submitJa);
    }
    if (step === "jaReview") {
      $("#btn-back-ja").addEventListener("click", () => { editing.step = "ja"; renderEditor(); });
      $("#btn-go-en").addEventListener("click", async () => {
        editing.step = "en";
        renderEditor();
        persistRecord(editing).catch((error) => console.warn(error));
      });
    }
    if (step === "en") {
      $$("[data-en]").forEach((area) => area.addEventListener("input", () => {
        const [r, i] = area.dataset.en.split("-").map(Number);
        editing.reasons[r].en[i] = area.value;
      }));
      $("#btn-back-jareview").addEventListener("click", () => { editing.step = "jaReview"; renderEditor(); });
      $("#btn-review-en").addEventListener("click", submitEn);
    }
    if (step === "result") bindResultEvents(editing);
  }

  async function submitJa() {
    clearError("ja-error");
    const problem = validateJa(editing);
    if (problem) return showError("ja-error", problem);
    const body = {
      topic: editing.topic,
      stance: editing.stance,
      reasons: editing.reasons.map((reason) => ({ point: reason.point, ja: reason.ja.map((s) => s.trim()) }))
    };
    try {
      setBusy(true, "AIが日本語を添削しています（1分ほどかかります）");
      const result = await callAI("/api/review-ja", body);
      editing.jaReview = normalizeJaReview(result, editing);
      editing.step = "jaReview";
      await persistRecord(editing).catch((error) => console.warn(error));
      logActivity("ja", editing);
      renderEditor();
    } catch (error) {
      showError("ja-error", error.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitEn() {
    clearError("en-error");
    const problem = validateEn(editing);
    if (problem) return showError("en-error", problem);
    const body = {
      topic: editing.topic,
      stance: editing.stance,
      reasons: editing.reasons.map((reason, r) => ({
        point: reason.point,
        ja: [0, 1, 2].map((i) => revisedJa(editing, r, i)),
        en: reason.en.map((s) => s.trim())
      }))
    };
    let result;
    try {
      setBusy(true, "AIが英文を添削して、全文を組み立てています（1分ほどかかります）");
      result = await callAI("/api/review-en", body);
    } catch (error) {
      setBusy(false);
      showError("en-error", error.message);
      return;
    }
    const firstFinish = editing.status !== "done";
    editing.enReview = normalizeEnReview(result, editing);
    editing.essay = buildEssay(editing);
    editing.step = "result";
    editing.status = "done";
    editing.completedAt = new Date().toISOString();
    renderEditor();
    try {
      await persistRecord(editing);
      if (firstFinish) await logActivity("done", editing);
      showToast("ノートに保存しました");
    } catch (error) {
      console.error(error);
      showToast("ノートに保存できませんでした。通信を確認してから「学習データ（ノート）を見る」を押してください");
    } finally {
      setBusy(false);
    }
  }

  function validateJa(record) {
    if (!record.stance) return "賛成か反対かを選んでください。";
    if (!record.reasons[0].point || !record.reasons[1].point) return "理由1と理由2のPOINTを選んでください。";
    if (record.reasons[0].point === record.reasons[1].point) return "理由1と理由2は、ちがうPOINTを選んでください。";
    for (let r = 0; r < 2; r += 1) {
      for (let i = 0; i < 3; i += 1) {
        if (record.reasons[r].ja[i].trim().length < 4) return `理由${r + 1}の${i + 1}文目を書いてください。`;
      }
    }
    return "";
  }

  function validateEn(record) {
    for (let r = 0; r < 2; r += 1) {
      for (let i = 0; i < 3; i += 1) {
        const text = record.reasons[r].en[i].trim();
        if (!text) return `理由${r + 1}の${i + 1}文目を英語で書いてください。`;
        if (/[ぁ-んァ-ヶ一-龠]/.test(text)) return `理由${r + 1}の${i + 1}文目に日本語が入っています。英語で書いてみよう。`;
      }
    }
    return "";
  }

  function revisedJa(record, r, i) {
    const sentence = record.jaReview ? record.jaReview.sentences.find((s) => s.reason === r + 1 && s.index === i + 1) : null;
    return (sentence && sentence.revised) || record.reasons[r].ja[i];
  }

  function normalizeJaReview(result, record) {
    const list = Array.isArray(result && result.sentences) ? result.sentences : [];
    const sentences = [];
    for (let r = 0; r < 2; r += 1) {
      for (let i = 0; i < 3; i += 1) {
        const found = list.find((s) => Number(s.reason) === r + 1 && Number(s.index) === i + 1) || list[r * 3 + i] || {};
        sentences.push({
          reason: r + 1,
          index: i + 1,
          original: record.reasons[r].ja[i],
          revised: String(found.revised || record.reasons[r].ja[i]),
          comment: String(found.comment || ""),
          grammar: Array.isArray(found.grammar) ? found.grammar.map(String) : [],
          phraseNo: Number(found.phraseNo) || 0
        });
      }
    }
    return { sentences, overall: String((result && result.overall) || "") };
  }

  function normalizeEnReview(result, record) {
    const list = Array.isArray(result && result.corrections) ? result.corrections : [];
    const corrections = [];
    for (let r = 0; r < 2; r += 1) {
      for (let i = 0; i < 3; i += 1) {
        const found = list.find((c) => Number(c.reason) === r + 1 && Number(c.index) === i + 1) || list[r * 3 + i] || {};
        const student = record.reasons[r].en[i];
        corrections.push({
          reason: r + 1,
          index: i + 1,
          student,
          corrected: String(found.corrected || student),
          changed: Boolean(found.changed),
          comment: String(found.comment || "")
        });
      }
    }
    const p1 = (result && result.paragraph1) || {};
    const p4 = (result && result.paragraph4) || {};
    const v = (result && result.viewpoints) || {};
    return {
      corrections,
      paragraph1: { text: String(p1.text || ""), ja: String(p1.ja || ""), notes: (p1.notes || []).map(String) },
      paragraph4: { text: String(p4.text || ""), ja: String(p4.ja || ""), nouns: (p4.nouns || []).map(String), notes: (p4.notes || []).map(String) },
      viewpoints: { content: String(v.content || ""), structure: String(v.structure || ""), vocabulary: String(v.vocabulary || ""), grammar: String(v.grammar || "") },
      overall: String((result && result.overall) || "")
    };
  }

  function buildEssay(record) {
    const review = record.enReview;
    const reasonParagraph = (r) => review.corrections.filter((c) => c.reason === r).sort((a, b) => a.index - b.index).map((c) => c.corrected.trim()).join(" ");
    const paragraphs = [review.paragraph1.text.trim(), reasonParagraph(1), reasonParagraph(2), review.paragraph4.text.trim()];
    return { paragraphs, wordCount: countWords(paragraphs.join(" ")) };
  }

  function countWords(text) {
    return String(text).split(/\s+/).filter((token) => /[A-Za-z0-9]/.test(token)).length;
  }

  // ===== AI（中継サーバー経由。デモはその場で仮の結果を作る） =====
  async function callAI(path, body) {
    if (LOCAL_AI) {
      let response;
      try {
        response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      } catch (error) {
        throw new Error("試験用の窓口（この PC の Codex）につながりませんでした。窓口が動いているか確かめてください。");
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || `Codexの添削に失敗しました（${response.status}）`);
      return data.result;
    }
    if (localMode) {
      await new Promise((resolve) => window.setTimeout(resolve, 900));
      return path === "/api/review-ja" ? mockJaReview(body) : mockEnReview(body);
    }
    if (!AI_URL) throw new Error("AIの設定がまだありません。先生に知らせてください。");
    const token = await auth.currentUser.getIdToken();
    let response;
    try {
      response = await fetch(AI_URL + path, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body)
      });
    } catch (error) {
      throw new Error("AIにつながりませんでした。通信状態を確認して、もう一度押してください。");
    }
    let data = {};
    try {
      data = await response.json();
    } catch (error) {
      data = {};
    }
    if (!response.ok) throw new Error(data.message || `AIの添削に失敗しました（${response.status}）。もう一度押してください。`);
    return data.result;
  }

  function mockJaReview(body) {
    if (EXAMPLE && body.topic.id === EXAMPLE.topic.id) return JSON.parse(JSON.stringify(EXAMPLE.jaReview));
    return {
      sentences: body.reasons.flatMap((reason, r) => reason.ja.map((text, i) => ({
        reason: r + 1,
        index: i + 1,
        original: text,
        revised: /[。！？]$/.test(text) ? text : `${text}。`,
        comment: "（デモ表示）AIにつながると、どの英文法で書くかを見越した直しの意図がここに出ます。",
        grammar: [],
        phraseNo: 0
      }))),
      overall: "（デモ表示）これはAIにつながっていない確認用の画面です。日本語はそのまま次に進みます。"
    };
  }

  function mockEnReview(body) {
    if (EXAMPLE && body.topic.id === EXAMPLE.topic.id) return JSON.parse(JSON.stringify(EXAMPLE.enReview));
    const useModel = MODEL && body.topic.id === MODEL.topicId && body.stance === MODEL.stance;
    const corrections = body.reasons.flatMap((reason, r) => reason.en.map((text, i) => {
      let corrected = text;
      if (i === 0 && r === 0 && !/^firstly/i.test(text)) corrected = `Firstly, ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
      if (i === 0 && r === 1 && !/^additionally/i.test(text)) corrected = `Additionally, ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
      return { reason: r + 1, index: i + 1, student: text, corrected, changed: corrected !== text, comment: "（デモ表示）AIにつながると、直した理由がここに出ます。" };
    }));
    const demoNote = "（デモ表示）AIにつながると、トピックとあなたの立場から作った段落がここに出ます。";
    return {
      corrections,
      paragraph1: useModel ? {
        text: MODEL.paragraphs[0],
        ja: MODEL.paragraphsJa[0],
        notes: [
          "1文目：Nowadays, ＋トピックの名詞＋has been a controversial issue in Japan. 名詞のかたまりを入れ替えればほかのトピックでも使える。",
          "2文目：Although some argue that we don't have to change 〜（don't have to＋動詞の原形）。3文目をただ否定にした形にしないのがポイント。",
          "3文目：I strongly believe that high school education should be improved（助動詞＋受動態）for the following two reasons."
        ]
      } : { text: "(Demo) Nowadays, ... has been a controversial issue in Japan. Although some argue that ..., I strongly believe that ... for the following two reasons.", ja: demoNote, notes: [demoNote] },
      paragraph4: useModel ? {
        text: MODEL.paragraphs[3],
        ja: MODEL.paragraphsJa[3],
        nouns: ["the necessity of changing curriculum", "adaptation to globalization"],
        notes: [
          "理由1「カリキュラムが生徒の力を伸ばすのに効果的でない」→ the necessity of changing curriculum（動名詞 changing を使った名詞のかたまり）",
          "理由2「グローバル社会で英語を話す力を伸ばす必要がある」→ adaptation to globalization（adapt を名詞 adaptation に語形変化）",
          "結論：there is no doubt that we should improve 〜（能動態）。1段落目の3文目（助動詞＋受動態）と形を変えている。"
        ]
      } : { text: "(Demo) In conclusion for the above-mentioned two reasons, ..., and ..., there is no doubt that ...", ja: demoNote, nouns: [], notes: [demoNote] },
      viewpoints: { content: "（デモ表示）", structure: "（デモ表示）", vocabulary: "（デモ表示）", grammar: "（デモ表示）" },
      overall: "（デモ表示）これはAIにつながっていない確認用の画面です。"
    };
  }

  // ===== 結果（全文）の表示：書く画面・ノート・管理画面で共通 =====
  function renderResult(record, options) {
    if (!record.essay || !record.enReview) return renderDraftSummary(record);
    const review = record.enReview;
    const essay = record.essay;
    const own = Boolean(options && options.own);
    const paragraphHtml = essay.paragraphs.map((text, p) => {
      const generated = p === 0 || p === 3;
      const label = generated ? (p === 0 ? "1段落目（型・アプリが作成）" : "4段落目（型・アプリが作成）") : `${p + 1}段落目（あなたの理由${p}・添削後）`;
      return `<div class="essay-paragraph ${generated ? "generated" : ""}">
        <p class="essay-label">${label}</p>
        <p class="essay-text" ${generated ? "data-memorize" : ""}>${escapeHtml(text)}</p>
      </div>`;
    }).join("");

    const wordNote = essay.wordCount < 120 || essay.wordCount > 150 ? "（目安120〜150語）" : "";
    const corrections = [1, 2].map((r) => `
      <h3>理由${r}</h3>
      ${review.corrections.filter((c) => c.reason === r).map((c) => `
        <div class="correction ${c.changed ? "changed" : "kept"}">
          <p class="review-role">${SENTENCE_ROLES[c.index - 1] || ""}</p>
          <p class="corr-before"><span>あなた</span>${escapeHtml(c.student)}</p>
          ${c.changed ? `<p class="corr-after"><span>添削</span>${escapeHtml(c.corrected)}</p>` : `<p class="corr-ok">このままでOK</p>`}
          ${c.comment ? `<p class="review-comment">${escapeHtml(c.comment)}</p>` : ""}
        </div>`).join("")}`).join("");

    const viewpointHtml = SCORING.map((item) => review.viewpoints[item.key] ? `
      <div class="viewpoint"><b>${escapeHtml(item.label)}</b><p>${escapeHtml(review.viewpoints[item.key])}</p></div>` : "").join("");

    const jaLog = record.jaReview ? record.jaReview.sentences.map((s) => `
      <div class="review-item compact">
        <p class="review-role">理由${s.reason}・${s.index}文目</p>
        <p class="review-before"><span>はじめ</span>${escapeHtml(s.original)}</p>
        <p class="review-after"><span>直した</span>${escapeHtml(s.revised)}</p>
        ${s.comment ? `<p class="review-comment">${escapeHtml(s.comment)}</p>` : ""}
      </div>`).join("") : "";

    return `
      <section class="work-panel essay-panel">
        <div class="essay-head">
          <h2>全文 <span class="word-count">${essay.wordCount}語${wordNote}</span></h2>
          <button class="btn btn-secondary btn-small" data-toggle-memorize>1・4段落をかくす（暗記用）</button>
        </div>
        <p class="hint">立場：${record.stance === "disagree" ? "反対" : "賛成"}　理由1：${escapeHtml(record.reasons[0].point)}　理由2：${escapeHtml(record.reasons[1].point)}</p>
        ${paragraphHtml}
      </section>

      ${options && options.ownerName ? "" : `<section class="work-panel line-panel">
        <h2>わからない所は先生にLINEで質問</h2>
        <p class="hint">なぜこの形になるのか分からない所（関係代名詞・受動態など）は、先生にLINEで聞こう。「LINEで送る」を押すと下の文がコピーされて、ハピクルのLINEが開くので、貼りつけて送ってね。最後の「質問」に聞きたいことを書いてね。</p>
        <pre class="copy-block" id="copy-block">${escapeHtml(buildCopyText(record, options && options.ownerName))}</pre>
        <div class="button-row">
          <button class="btn btn-primary" data-copy>コピーする</button>
          <a class="btn btn-secondary" data-line-share href="${LINE_URL}" target="_blank" rel="noopener">LINEで送る</a>
        </div>
      </section>`}

      <section class="work-panel">
        <h2>1段落目と4段落目の型のポイント</h2>
        <h3>1段落目</h3>
        ${review.paragraph1.ja ? `<p class="ja-translation">${escapeHtml(review.paragraph1.ja)}</p>` : ""}
        <ul class="note-list">${review.paragraph1.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>
        <h3>4段落目</h3>
        ${review.paragraph4.ja ? `<p class="ja-translation">${escapeHtml(review.paragraph4.ja)}</p>` : ""}
        <ul class="note-list">${review.paragraph4.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>
      </section>

      <section class="work-panel">
        <h2>あなたの英文と添削</h2>
        ${corrections}
      </section>

      ${viewpointHtml ? `<section class="work-panel"><h2>英検の4つの観点から</h2><p class="hint">英検の英作文は「内容・構成・語彙・文法」の4つの観点で採点されます。</p>${viewpointHtml}</section>` : ""}
      ${review.overall ? `<section class="ai-note"><p class="panel-label">AIからのひとこと</p><p>${escapeHtml(review.overall)}</p></section>` : ""}
      ${jaLog ? `<details class="work-panel"><summary>日本語の添削の記録</summary>${jaLog}</details>` : ""}
      ${own ? `<div class="button-row">
        <button class="btn btn-secondary" data-go-notes>学習データ（ノート）を見る</button>
        <button class="btn btn-primary" data-go-home>ほかのトピックを書く</button>
      </div>` : ""}`;
  }

  function renderDraftSummary(record) {
    const lines = record.reasons.map((reason, r) => `
      <h3>理由${r + 1}${reason.point ? `（${escapeHtml(reason.point)}）` : ""}</h3>
      <ol>${reason.ja.map((text, i) => `<li>${escapeHtml(revisedJa(record, r, i) || text || "（未記入）")}${reason.en[i] ? `<br><span class="en-line">${escapeHtml(reason.en[i])}</span>` : ""}</li>`).join("")}</ol>`).join("");
    return `<section class="work-panel"><p class="badge badge-draft">書きかけ（${stepLabel(record.step)}の途中）</p>${lines}</section>`;
  }

  function buildCopyText(record, ownerName) {
    const essay = record.essay;
    const lines = [
      `【準1級 英作文】${record.topic.label || ""}${ownerName ? `　${ownerName}` : ""}`,
      `TOPIC：${record.topic.en}`,
      `立場：${record.stance === "disagree" ? "反対" : "賛成"}／理由1：${record.reasons[0].point}／理由2：${record.reasons[1].point}`,
      "",
      `■ 全文（${essay.wordCount}語）`,
      essay.paragraphs.join("\n\n"),
      "",
      "■ 自分の英文 → 添削"
    ];
    record.enReview.corrections.forEach((c) => {
      lines.push(`理由${c.reason}-${c.index}`);
      lines.push(`自分：${c.student}`);
      lines.push(c.changed ? `添削：${c.corrected}` : "添削：このままでOK");
    });
    lines.push("", "■ 質問", "（わからないところをここに書いて送ってね）");
    return lines.join("\n");
  }

  function bindResultEvents(record) {
    const copyText = record.essay ? buildCopyText(record, null) : "";
    const copyButton = document.querySelector("[data-copy]");
    if (copyButton) {
      copyButton.addEventListener("click", async () => {
        const text = $("#copy-block") ? $("#copy-block").textContent : copyText;
        try {
          await navigator.clipboard.writeText(text);
          showToast("コピーしました。LINEに貼りつけてね");
        } catch (error) {
          selectText($("#copy-block"));
          showToast("長押しでコピーしてください");
        }
      });
    }
    const share = document.querySelector("[data-line-share]");
    if (share) {
      share.addEventListener("click", () => {
        const text = $("#copy-block") ? $("#copy-block").textContent : copyText;
        if (navigator.clipboard) {
          navigator.clipboard.writeText(text).then(() => showToast("コピーしました。LINEで貼りつけて送ってね")).catch(() => {});
        }
      });
    }
    const toggle = document.querySelector("[data-toggle-memorize]");
    if (toggle) {
      toggle.addEventListener("click", () => {
        const hidden = !document.body.classList.contains("memorize-mode");
        document.body.classList.toggle("memorize-mode", hidden);
        toggle.textContent = hidden ? "1・4段落を見せる" : "1・4段落をかくす（暗記用）";
      });
    }
    $$("[data-memorize]").forEach((element) => element.addEventListener("click", () => element.classList.toggle("peek")));
    const goNotes = document.querySelector("[data-go-notes]");
    if (goNotes) goNotes.addEventListener("click", () => closeEditor("screen-stats"));
    const goHome = document.querySelector("[data-go-home]");
    if (goHome) goHome.addEventListener("click", () => closeEditor("screen-home"));
  }


  // ===== 学習データ（単語アプリの「学習データ」の並び＋ノート） =====
  function openStats() {
    $("#stats-username").textContent = currentProfile?.name || "";
    const log = moduleState.dailyLog;
    $("#streak-num").textContent = calcStreak(log);
    $("#streak-best").textContent = calcBestStreak(log);
    $("#stats-points").textContent = Number(moduleState.points || 0).toLocaleString("ja-JP");
    renderStreakWeek();
    renderStatsBody();
    showScreen("screen-stats");
  }

  function renderStreakWeek() {
    const today = new Date();
    const DOW = ["日", "月", "火", "水", "木", "金", "土"];
    let html = "";
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const day = moduleState.dailyLog[dateKey(d)];
      const studied = activityCount(day) > 0;
      const done = day?.done || 0;
      html += `
        <div class="streak-day">
          <div class="streak-day-label${i === 0 ? " today-label" : ""}">${i === 0 ? "今日" : DOW[d.getDay()]}</div>
          <div class="streak-day-date">${d.getMonth() + 1}/${d.getDate()}</div>
          <div class="streak-circle${studied ? " studied" : ""}">${studied ? "✓" : ""}</div>
          <div class="streak-day-count">${done > 0 ? `${done}題` : ""}</div>
        </div>`;
    }
    $("#streak-week").innerHTML = html;
  }

  function renderStatsBody() {
    const log = moduleState.dailyLog;
    const today = log[dateKey(new Date())] || {};
    const done = records.filter((record) => record.status === "done");
    const drafts = records.filter((record) => record.status !== "done");
    const totalWords = done.reduce((sum, record) => sum + (record.essay?.wordCount || 0), 0);
    const studiedDays = Object.keys(log).filter((d) => activityCount(log[d]) > 0).length;
    const topicsTried = new Set(done.map((record) => record.topicId)).size;

    $("#stats-today").innerHTML = `
      <div class="stat-item"><div class="stat-num">${today.done || 0}</div><div class="stat-label">今日書いた題数</div></div>
      <div class="stat-item"><div class="stat-num">${today.ja || 0}</div><div class="stat-label">今日の日本語の添削</div></div>
      <div class="stat-item"><div class="stat-num">${today.words || 0}</div><div class="stat-label">今日書いた語数</div></div>`;

    $("#stats-effort-grid").innerHTML = `
      <div class="stat-item"><div class="stat-num">${done.length}</div><div class="stat-label">書き上げた題数</div></div>
      <div class="stat-item"><div class="stat-num">${drafts.length}</div><div class="stat-label">書きかけ</div></div>
      <div class="stat-item"><div class="stat-num">${studiedDays}</div><div class="stat-label">学習した日数</div></div>
      <div class="stat-item"><div class="stat-num">${topicsTried}<span class="stat-of"> / ${TOPICS.length}</span></div><div class="stat-label">取り組んだトピック</div></div>
      <div class="stat-item"><div class="stat-num">${totalWords}</div><div class="stat-label">書いた語数の合計</div></div>
      <div class="stat-item"><div class="stat-num">${done.length ? Math.round(totalWords / done.length) : "—"}</div><div class="stat-label">1題の平均語数<br>（目安120〜150語）</div></div>`;

    $("#notes-list").innerHTML = notesListHtml(records, "own");
    renderHistory(moduleState.historyLog, $("#stats-history"), "stats");
    statsCalViewDate = new Date();
    renderCalendarView(log, $("#stats-calendar"), "stats");
    renderLineChart(log, $("#stats-chart"));
  }

  function notesListHtml(list, scope) {
    if (!list.length) {
      return scope === "own"
        ? `<p class="empty-panel">まだありません。<a href="#" class="inline-link" data-go="screen-home">「書く」</a>からトピックを選んで始めよう。</p>`
        : `<p class="detail-empty">まだ英作文の記録がありません。</p>`;
    }
    return list.map((record) => recordRowHtml(record, scope)).join("");
  }

  function recordRowHtml(record, scope) {
    const state = record.status === "done"
      ? `<span class="badge badge-done">完了 ${record.essay?.wordCount || 0}語</span>`
      : `<span class="badge badge-draft">書きかけ・${stepLabel(record.step)}</span>`;
    return `
      <button class="record-row" data-record="${escapeAttr(record.id)}" data-record-scope="${scope}">
        <span class="record-date">${formatDate(record.completedAt || record.updatedAt || record.createdAt)}</span>
        <span class="record-topic">${escapeHtml(record.topic.en)}</span>
        <span class="record-meta">${escapeHtml(record.topic.label || "")} ${state}</span>
      </button>`;
  }

  function openRecordFromList(id, scope) {
    if (scope === "detail") {
      const record = detailRecords.find((item) => item.id === id);
      const user = getDetailUser();
      if (!record) return;
      closeModal("student-detail-modal");
      openRecordView(record, { back: "detail", ownerName: user?.name || "" });
      return;
    }
    const record = records.find((item) => item.id === id);
    if (!record) return;
    if (record.status !== "done") openEditor(record);
    else openRecordView(record, { back: "screen-stats" });
  }

  function openRecordView(record, options) {
    recordBack = options.back;
    $("#record-label").textContent = `${record.topic.label || ""}　${formatDate(record.completedAt || record.updatedAt)}${options.ownerName ? `　${options.ownerName}` : ""}`;
    $("#record-topic-en").textContent = record.topic.en;
    $("#record-topic-ja").textContent = record.topic.ja || "";
    $("#record-body").innerHTML = renderResult(record, { own: false, ownerName: options.ownerName });
    document.body.classList.remove("memorize-mode");
    showScreen("screen-record");
    bindResultEvents(record);
    window.scrollTo({ top: 0 });
  }

  function backFromRecord() {
    if (recordBack === "detail") {
      showScreen("screen-admin");
      if (detailUid) {
        $("#student-detail-modal").classList.remove("hidden");
        renderDetailTab("notes");
      }
      return;
    }
    openStats();
  }

  // ===== 連続学習日数・カレンダー・グラフ・履歴（学習データと生徒詳細で共通） =====
  function activityCount(day) {
    return (day?.ja || 0) + (day?.done || 0) + (day?.phrase || 0);
  }

  function calcStreak(log) {
    const d = new Date();
    if (!activityCount(log[dateKey(d)])) d.setDate(d.getDate() - 1);
    let streak = 0;
    while (activityCount(log[dateKey(d)]) > 0) {
      streak += 1;
      d.setDate(d.getDate() - 1);
    }
    return streak;
  }

  function calcBestStreak(log) {
    const days = Object.keys(log).filter((key) => activityCount(log[key]) > 0).sort();
    let best = 0;
    let run = 0;
    let prev = null;
    days.forEach((key) => {
      const d = new Date(`${key}T00:00:00`);
      if (prev && (d - prev) / 86400000 === 1) run += 1;
      else run = 1;
      best = Math.max(best, run);
      prev = d;
    });
    return best;
  }

  function calNavMonth(delta, target) {
    if (target === "stats") {
      statsCalViewDate.setMonth(statsCalViewDate.getMonth() + delta);
      renderCalendarView(moduleState.dailyLog, $("#stats-calendar"), "stats");
      return;
    }
    adminCalViewDate.setMonth(adminCalViewDate.getMonth() + delta);
    const user = getDetailUser();
    if (user) renderCalendarView(user.dailyLog || {}, $("#detail-body"), "detail");
  }

  function renderCalendarView(dailyLog, container, target) {
    const viewDate = target === "stats" ? statsCalViewDate : adminCalViewDate;
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const todayStr = dateKey(new Date());
    const firstDow = new Date(year, month, 1).getDay();
    const lastDay = new Date(year, month + 1, 0).getDate();
    const values = Object.values(dailyLog).map((d) => d?.done || 0);
    const maxVal = Math.max(1, ...values);
    const DOW = ["日", "月", "火", "水", "木", "金", "土"];

    let html = `<div class="monthly-cal">
      <div class="monthly-cal-header">
        <button class="cal-nav-btn" data-cal-nav="-1" data-cal-target="${target}">‹</button>
        <span class="monthly-cal-title">${year}年${month + 1}月</span>
        <button class="cal-nav-btn" data-cal-nav="1" data-cal-target="${target}">›</button>
      </div>
      <div class="monthly-cal-dow">${DOW.map((d, i) => `<div class="dow-cell${i === 0 ? " dow-sun" : i === 6 ? " dow-sat" : ""}">${d}</div>`).join("")}</div>
      <div class="monthly-cal-grid">`;
    for (let i = 0; i < firstDow; i += 1) html += `<div class="mday-cell mday-empty"></div>`;
    for (let day = 1; day <= lastDay; day += 1) {
      const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const log = dailyLog[key];
      const done = log?.done || 0;
      const ja = log?.ja || 0;
      const dow = new Date(year, month, day).getDay();
      const level = done > 0 ? Math.min(4, Math.ceil((done / maxVal) * 4)) : 1;
      html += `<div class="mday-cell${key === todayStr ? " mday-today" : ""}${dow === 0 ? " mday-sun" : dow === 6 ? " mday-sat" : ""}${done || ja ? " mday-studied" : ""}">
        <div class="mday-num">${day}</div>
        ${done > 0 ? `<div class="mday-badge cal-lv${level}">${done}題</div>` : ""}
        ${ja > 0 && done === 0 ? `<div class="mday-fc">✎${ja}</div>` : ""}
      </div>`;
    }
    html += `</div></div>
      <div class="cal-legend-text"><span class="mday-badge cal-lv3">◯題</span> その日に全文まで書き上げた題数　<span class="mday-fc">✎◯</span> 日本語の添削だけした回数</div>`;
    container.innerHTML = html;
  }

  function renderLineChart(dailyLog, container) {
    const days = Object.keys(dailyLog).filter((key) => (dailyLog[key]?.done || 0) > 0).sort();
    if (!days.length) {
      container.innerHTML = `<p class="detail-empty">まだ記録がありません。</p>`;
      return;
    }
    let total = 0;
    let entries = days.map((key) => [key, (total += dailyLog[key].done)]);
    if (entries.length === 1) entries = [[entries[0][0], 0], ...entries];
    const W = 320;
    const H = 180;
    const PL = 36;
    const PR = 12;
    const PT = 12;
    const PB = 32;
    const n = entries.length;
    const maxY = Math.max(5, ...entries.map(([, v]) => v));
    const xs = (i) => PL + (i / (n - 1)) * (W - PL - PR);
    const ys = (v) => PT + (1 - v / maxY) * (H - PT - PB);
    const points = entries.map(([, v], i) => `${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(" ");
    const area = `M${xs(0).toFixed(1)},${ys(entries[0][1]).toFixed(1)} ${entries.slice(1).map(([, v], i) => `L${xs(i + 1).toFixed(1)},${ys(v).toFixed(1)}`).join(" ")} L${xs(n - 1).toFixed(1)},${ys(0).toFixed(1)} L${xs(0).toFixed(1)},${ys(0).toFixed(1)} Z`;
    const yTicks = [0, Math.round(maxY / 2), maxY];
    const xIdxs = [...new Set([0, Math.floor(n / 2), n - 1])];
    container.innerHTML = `<div class="chart-wrap">
      <p class="chart-title">書き上げた題数（合計）の推移</p>
      <svg viewBox="0 0 ${W} ${H}" class="line-chart-svg" xmlns="http://www.w3.org/2000/svg">
        <path d="${area}" class="chart-area"/>
        <polyline points="${points}" class="chart-line" fill="none"/>
        ${entries.map(([, v], i) => `<circle cx="${xs(i).toFixed(1)}" cy="${ys(v).toFixed(1)}" r="3" class="chart-dot"><title>${entries[i][0]}：${v}題</title></circle>`).join("")}
        <line x1="${PL}" y1="${PT}" x2="${PL}" y2="${H - PB}" class="chart-axis"/>
        <line x1="${PL}" y1="${H - PB}" x2="${W - PR}" y2="${H - PB}" class="chart-axis"/>
        ${yTicks.map((v) => `<text x="${PL - 6}" y="${(ys(v) + 4).toFixed(1)}" class="chart-label" text-anchor="end">${v}</text>`).join("")}
        ${xIdxs.map((i) => `<text x="${xs(i).toFixed(1)}" y="${H - PB + 14}" class="chart-label" text-anchor="middle">${entries[i][0].slice(5)}</text>`).join("")}
      </svg>
      <div class="chart-legend"><span class="legend-main">━ 書き上げた題数（その日までの合計）</span></div>
    </div>`;
  }

  const HISTORY_TYPES = { ja: "日本語の添削", done: "全文ができた", phrase: "フレーズ" };

  function renderHistory(log, container, target) {
    const filter = historyFilter[target];
    const list = (log || []).filter((h) => filter === "all" || h.type === filter);
    const chips = [["all", "すべて"], ["done", "全文ができた"], ["ja", "日本語の添削"], ["phrase", "フレーズ"]].map(([key, label]) =>
      `<button class="chip${filter === key ? " active" : ""}" data-history-filter="${key}" data-history-target="${target}">${label}</button>`).join("");
    let html = `<div class="history-head"><div class="filter-chips">${chips}</div></div>`;
    if (!list.length) {
      html += `<p class="detail-empty">履歴はまだありません。</p>`;
    } else {
      html += `<div class="history-list">${list.slice(0, 100).map((h) => {
        const d = new Date(h.at);
        const when = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
        if (h.type === "phrase") return phraseHistoryItemHtml(h, when);
        return `<div class="history-item${h.type === "done" ? " h-pass" : ""}">
          <div class="h-top"><span class="h-when">${when}</span><span class="h-what">${escapeHtml(h.label || "")}</span></div>
          <div class="h-mid">${escapeHtml(h.topicEn || "")}</div>
          <div class="h-status">${h.type === "done" ? `🏆 ${HISTORY_TYPES.done}（${h.words || 0}語）` : HISTORY_TYPES.ja}</div>
        </div>`;
      }).join("")}</div>`;
    }
    container.innerHTML = html;
    container.dataset.historyTarget = target;
    container._historyLog = log || [];
  }

  // フレーズの履歴1行（単語アプリの履歴と同じ書き方）
  function phraseHistoryItemHtml(h, when) {
    const mode = PHRASE_MODE_NAMES[h.mode] || "練習";
    const result = h.mode === "flashcard" ? `わかった ${h.correct}/${h.answered}枚` : `${h.correct}/${h.mode === "normal" ? h.total : h.answered}`;
    const status = { pass: "🏆 合格", seqFull: "満点（順番通り）", paused: "途中でやめた", done: h.mode === "normal" ? "本番終了" : "おわり" }[h.status] || "";
    return `<div class="history-item${h.status === "pass" ? " h-pass" : ""}">
      <div class="h-top"><span class="h-when">${when}</span><span class="h-what">${escapeHtml(h.label || "フレーズ")}</span></div>
      <div class="h-mid">${escapeHtml(mode)}${h.mode === "normal" && h.round ? `・${h.round}周目` : ""}</div>
      <div class="h-status">${escapeHtml(status)}（${escapeHtml(result)}）</div>
    </div>`;
  }

  function setHistoryFilter(target, filter) {
    historyFilter[target] = filter;
    if (target === "stats") renderHistory(moduleState.historyLog, $("#stats-history"), "stats");
    else {
      const user = getDetailUser();
      renderHistory(user?.historyLog || [], $("#detail-body"), "detail");
    }
  }

  // ===== マイページ（単語アプリと同じ並び） =====
  function openMyPage() {
    $("#profile-name-text").textContent = currentProfile?.name || "";
    $("#profile-id-text").textContent = currentProfile?.userId || "";
    $("#profile-name-display").classList.remove("hidden");
    $("#profile-name-edit").classList.add("hidden");
    const done = records.filter((record) => record.status === "done");
    const studiedDays = Object.keys(moduleState.dailyLog).filter((d) => activityCount(moduleState.dailyLog[d]) > 0).length;
    $("#effort-grid").innerHTML = `
      <div class="stat-item"><div class="stat-num">${done.length}</div><div class="stat-label">書き上げた題数</div></div>
      <div class="stat-item"><div class="stat-num">${studiedDays}</div><div class="stat-label">学習した日数</div></div>
      <div class="stat-item"><div class="stat-num">${calcStreak(moduleState.dailyLog)}</div><div class="stat-label">🔥 連続学習日数</div></div>
      <div class="stat-item"><div class="stat-num">${Number(moduleState.points || 0).toLocaleString("ja-JP")}</div><div class="stat-label">⭐ ポイント</div></div>`;
    showScreen("screen-mypage");
  }

  async function saveName() {
    const newName = $("#edit-name-input").value.trim();
    if (!newName) return;
    const button = $("#btn-save-name");
    button.textContent = "保存中...";
    button.disabled = true;
    try {
      if (localMode) {
        const users = getLocalUsers();
        users[currentUser.uid].name = newName;
        setLocalUsers(users);
      } else {
        await userDocRef(currentUser.uid).update({ name: newName });
      }
      currentProfile.name = newName;
      $("#home-user-name").textContent = newName;
      $("#admin-teacher-name").textContent = `講師: ${newName}`;
      openMyPage();
    } catch (error) {
      window.alert(`保存に失敗しました: ${error.message}`);
    } finally {
      button.textContent = "保存";
      button.disabled = false;
    }
  }

  function openEditIdModal() {
    $("#edit-id-new").value = "";
    $("#edit-id-password").value = "";
    clearError("edit-id-error");
    openModal("edit-id-modal");
    window.setTimeout(() => $("#edit-id-new").focus(), 50);
  }

  async function submitEditId() {
    const newId = $("#edit-id-new").value.trim();
    const password = $("#edit-id-password").value;
    const button = $("#btn-submit-edit-id");
    clearError("edit-id-error");
    if (!newId) return showError("edit-id-error", "新しいIDを入力してください。");
    if (newId.includes("@")) return showError("edit-id-error", "IDに @ は使えません。");
    if (newId === currentProfile?.userId) return showError("edit-id-error", "現在のIDと同じです。");
    if (!password) return showError("edit-id-error", "現在のパスワードを入力してください。");
    try {
      button.disabled = true;
      button.textContent = "変更中...";
      if (localMode) {
        const users = getLocalUsers();
        if (Object.values(users).some((user) => user.userId === newId)) return showError("edit-id-error", "このIDはすでに使用されています。");
        if (users[currentUser.uid].password !== password) return showError("edit-id-error", "現在のパスワードが正しくありません。");
        users[currentUser.uid].userId = newId;
        setLocalUsers(users);
      } else {
        // 単語アプリと同じ手順：重複チェック → 再認証 → ログイン用メール更新 → users の書類を更新
        const dup = await db.collection("users").where("userId", "==", newId).get();
        if (!dup.empty) return showError("edit-id-error", "このIDはすでに使用されています。");
        const user = auth.currentUser;
        const credential = firebase.auth.EmailAuthProvider.credential(user.email, password);
        await user.reauthenticateWithCredential(credential);
        await user.updateEmail(idToEmail(newId));
        await userDocRef(user.uid).set({ userId: newId, password }, { merge: true });
      }
      currentProfile.userId = newId;
      $("#profile-id-text").textContent = newId;
      closeModal("edit-id-modal");
      window.alert("IDを変更しました。次回ログインからは新しいIDをご利用ください（単語アプリなども同じIDになります）。");
    } catch (error) {
      const code = error.code || "";
      let message;
      if (code === "auth/wrong-password" || code === "auth/invalid-credential") message = "現在のパスワードが正しくありません。";
      else if (code === "auth/email-already-in-use") message = "このIDはすでに使用されています。";
      else if (code === "auth/requires-recent-login") message = "再ログインが必要です。一度ログアウトしてからやり直してください。";
      else if (code === "auth/operation-not-allowed") message = "IDの変更がサーバー側で許可されていません。管理者に連絡してください。";
      else message = authErrorMsg(code) || `エラーが発生しました（${code || error.message}）`;
      showError("edit-id-error", message);
    } finally {
      button.disabled = false;
      button.textContent = "変更する";
    }
  }

  function openReport() {
    $("#report-message").value = "";
    updateReportCount();
    clearError("report-error");
    $$(".report-type-btn").forEach((button, i) => button.classList.toggle("active", i === 0));
    openModal("report-modal");
  }

  function updateReportCount() {
    const length = $("#report-message").value.trim().length;
    const count = $("#report-char-count");
    count.textContent = length < 20 ? `${length}文字（20文字以上必要）` : `${length}文字 ✓`;
    count.className = `report-char-count${length >= 20 ? " valid" : ""}`;
    $("#btn-submit-report").disabled = length < 20;
  }

  async function submitReport() {
    const message = $("#report-message").value.trim();
    if (message.length < 20) return;
    const type = $(".report-type-btn.active")?.dataset.type || "other";
    const button = $("#btn-submit-report");
    button.textContent = "送信中...";
    button.disabled = true;
    const payload = { app: MODULE_ID, type, message, userId: currentUser.uid, userName: currentProfile?.name || "" };
    try {
      if (localMode) {
        const saved = JSON.parse(localStorage.getItem(LOCAL_REPORTS_KEY) || "[]");
        saved.push({ ...payload, createdAt: new Date().toISOString() });
        localStorage.setItem(LOCAL_REPORTS_KEY, JSON.stringify(saved));
      } else {
        // 単語アプリと同じ reports に入れる（app: "writing" で見分ける）
        await db.collection("reports").add({ ...payload, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      }
      closeModal("report-modal");
      window.alert("ご報告ありがとうございます！");
    } catch (error) {
      showError("report-error", `送信に失敗しました: ${permissionMessage(error)}`);
      button.disabled = false;
    } finally {
      button.textContent = "送信";
    }
  }

  async function resetLearningData() {
    if (!window.confirm("ライティングアプリの学習データ（書いた英作文・履歴・ポイント）をすべて消します。元に戻せません。よろしいですか？\n（単語アプリなど、ほかのアプリのデータは消えません）")) return;
    if (!window.confirm("本当に消しますか？")) return;
    try {
      if (!localMode) {
        const snapshot = await recordsColRef(currentUser.uid).get();
        await Promise.all(snapshot.docs.map((doc) => doc.ref.delete()));
      }
      records = [];
      moduleState = { ...emptyModuleState(), tutorialDone: true };
      await persistModule();
      openMyPage();
      showToast("学習データをリセットしました");
    } catch (error) {
      window.alert(permissionMessage(error));
    }
  }

  // ===== 管理画面（単語アプリと同じ並び） =====
  function switchAdminTab(tab) {
    ["students", "teachers", "topics", "manual"].forEach((name) => {
      $(`#admin-panel-${name}`).classList.toggle("hidden", name !== tab);
      $(`#admin-tab-${name}`).classList.toggle("active", name === tab);
    });
    if (tab === "students") loadAdminStudents();
    if (tab === "teachers") loadAdminTeachers();
    if (tab === "topics") renderAdminTopics();
    if (tab === "manual") $("#admin-panel-manual").innerHTML = manualHtml();
  }

  async function fetchUsersByRole(role) {
    if (localMode) {
      return Object.values(getLocalUsers()).filter((user) => (user.role || "student") === role).map((user) => {
        const data = readLocalData(user.uid);
        return { ...user, module: normalizeModuleState(data.moduleState || {}), localRecords: data.records || [] };
      });
    }
    const snapshot = await db.collection("users").where("role", "==", role).get();
    const users = snapshot.docs.map((doc) => ({ uid: doc.id, ...doc.data() }));
    const modules = await Promise.all(users.map((user) => moduleDocRef(user.uid).get().catch(() => null)));
    return users.map((user, i) => ({ ...user, module: normalizeModuleState(modules[i] && modules[i].exists ? modules[i].data() : {}) }));
  }

  function moduleOf(user) {
    const module = user.module || emptyModuleState();
    if (user.localRecords) {
      module.essayCount = user.localRecords.filter((record) => record.status === "done").length;
      module.essayDraftCount = user.localRecords.filter((record) => record.status !== "done").length;
    }
    return module;
  }

  async function loadAdminStudents() {
    const wrap = $("#admin-table-wrap");
    wrap.innerHTML = `<p class="loading-text">データを読み込み中...</p>`;
    $("#admin-stats-bar").innerHTML = "";
    try {
      const students = await fetchUsersByRole("student");
      students.sort((a, b) => (a.name || "").localeCompare(b.name || "", "ja"));
      adminStudentsAll = students;
      adminStudentsMap = {};
      students.forEach((student) => { adminStudentsMap[student.uid] = student; });
      renderAdminStudents();
    } catch (error) {
      wrap.innerHTML = `<p class="form-error">読み込みエラー: ${escapeHtml(error.message)}<br>Firestoreのルール設定を確認してください。</p>`;
    }
  }

  function buildStudentRow(student) {
    const module = moduleOf(student);
    const log = module.dailyLog || {};
    const today = log[dateKey(new Date())] || {};
    const totals = Object.values(log).reduce((acc, d) => ({ done: acc.done + (d.done || 0), words: acc.words + (d.words || 0) }), { done: 0, words: 0 });
    return {
      student,
      archived: student.archived === true,
      done: module.essayCount || 0,
      drafts: module.essayDraftCount || 0,
      todayDone: today.done || 0,
      todayJa: today.ja || 0,
      avgWords: totals.done ? Math.round(totals.words / totals.done) : 0,
      streak: calcStreak(log),
      lastTopic: module.lastTopicLabel || "",
      updatedAt: module.lastActivityAt ? new Date(module.lastActivityAt) : null,
      active: (module.essayCount || 0) + (module.essayDraftCount || 0) > 0 || Object.keys(log).length > 0
    };
  }

  function sortValue(row, key) {
    if (key === "name") return row.student.name || "";
    if (key === "id") return row.student.userId || "";
    if (key === "done") return row.done;
    if (key === "drafts") return row.drafts;
    if (key === "today") return row.todayDone * 100 + row.todayJa;
    if (key === "avg") return row.avgWords;
    if (key === "streak") return row.streak;
    if (key === "updated") return row.updatedAt ? row.updatedAt.getTime() : 0;
    return 0;
  }

  function adminSort(key) {
    if (adminView.sortKey === key) adminView.sortDir = -adminView.sortDir;
    else {
      adminView.sortKey = key;
      adminView.sortDir = key === "name" || key === "id" ? 1 : -1;
    }
    renderAdminStudents();
  }

  function renderAdminStudents() {
    if (adminMode === "summary") {
      $("#admin-stats-bar").innerHTML = "";
      $("#admin-hidden-note").textContent = "";
      $("#admin-table-wrap").innerHTML = `<p class="loading-text">要約（大問4）は準備中です。できたら、ここで生徒ごとの要約の記録が見られます。</p>`;
      return;
    }
    let rows = adminStudentsAll.map(buildStudentRow);
    const activeRows = rows.filter((row) => !row.archived);
    $("#admin-stats-bar").innerHTML = `
      <div class="stat-item"><div class="stat-num">${activeRows.length}</div><div class="stat-label">在籍生徒数</div></div>
      <div class="stat-item"><div class="stat-num">${activeRows.filter((row) => row.todayDone + row.todayJa > 0).length}</div><div class="stat-label">本日学習</div></div>
      <div class="stat-item"><div class="stat-num">${activeRows.filter((row) => row.active).length}</div><div class="stat-label">英作文に<br>取り組んだ生徒</div></div>
      <div class="stat-item"><div class="stat-num">${rows.length - activeRows.length}</div><div class="stat-label">📦 アーカイブ</div></div>`;

    rows = rows.filter((row) => adminView.archive === "all" ? true : adminView.archive === "archived" ? row.archived : !row.archived);
    const q = adminView.query;
    if (q) rows = rows.filter((row) => (row.student.name || "").toLowerCase().includes(q) || (row.student.userId || "").toLowerCase().includes(q));
    const hiddenCount = rows.filter((row) => !row.active).length;
    if (!adminView.showInactive) rows = rows.filter((row) => row.active);
    const { sortKey, sortDir } = adminView;
    rows.sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      const c = typeof va === "string" ? va.localeCompare(vb, "ja") : va - vb;
      return c !== 0 ? c * sortDir : (a.student.name || "").localeCompare(b.student.name || "", "ja");
    });
    $("#admin-hidden-note").textContent = adminView.showInactive
      ? `英作文をやっていない生徒 ${hiddenCount} 人も表示中`
      : hiddenCount > 0 ? `英作文をやっていない生徒 ${hiddenCount} 人は隠しています` : "";
    renderAdminTable(rows);
  }

  function th(key, label, cls) {
    const sorted = adminView.sortKey === key;
    const arrow = sorted ? (adminView.sortDir > 0 ? " ▲" : " ▼") : "";
    return `<th class="${cls} th-help${sorted ? " th-sorted" : ""}" data-sort="${key}">${label}${arrow}</th>`;
  }

  function renderAdminTable(rows) {
    const wrap = $("#admin-table-wrap");
    if (!rows.length) {
      wrap.innerHTML = `<p class="loading-text">表示する生徒がいません。${adminView.showInactive ? "" : "（「やっていない生徒も表示」で全員を出せます）"}</p>`;
      return;
    }
    wrap.innerHTML = `
      <div class="admin-table-scroll">
      <table class="admin-table">
        <thead><tr>
          ${th("name", "氏名", "col-name")}
          ${th("id", "ID", "col-id")}
          ${th("done", "✍️<br>完了", "col-total")}
          ${th("drafts", "書き<br>かけ", "col-wrong")}
          ${th("today", "今日", "col-today")}
          ${th("avg", "平均<br>語数", "col-wrong")}
          ${th("streak", "🔥<br>連続", "col-wrong")}
          <th class="col-topic">最後のトピック</th>
          ${th("updated", "最終更新", "col-update")}
          <th class="col-action">操作</th>
        </tr></thead>
        <tbody>
        ${rows.map((row) => {
          const { student } = row;
          const tag = row.archived ? `<span class="row-tag">📦 アーカイブ</span>` : !row.active ? `<span class="row-tag">記録なし</span>` : "";
          return `<tr class="${row.archived ? "row-archived" : !row.active ? "row-hidden" : ""}">
            <td class="col-name col-name-link" data-open-user="${escapeAttr(student.uid)}" data-user-type="student"><strong>${escapeHtml(student.name || "—")}</strong>${tag}</td>
            <td class="col-id">${escapeHtml(student.userId || "—")}</td>
            <td class="col-total">${row.done ? `<div class="total-pct">${row.done}題</div>` : "—"}</td>
            <td class="col-wrong">${row.drafts || "—"}</td>
            <td class="col-today">${row.todayDone ? `${row.todayDone}題` : "—"}${row.todayJa ? `<br><small>✎${row.todayJa}</small>` : ""}</td>
            <td class="col-wrong">${row.avgWords || "—"}</td>
            <td class="col-wrong">${row.streak ? `${row.streak}日` : "—"}</td>
            <td class="col-topic">${escapeHtml(row.lastTopic || "—")}</td>
            <td class="col-update">${row.updatedAt ? row.updatedAt.toLocaleDateString("ja-JP") : "—"}</td>
            <td class="col-action">${row.archived
              ? `<button class="btn btn-restore btn-xsmall" data-admin-action="restore" data-uid="${escapeAttr(student.uid)}">↩ 在籍中に戻す</button>`
              : `<button class="btn btn-promote btn-xsmall" data-admin-action="promote" data-uid="${escapeAttr(student.uid)}">🏫 教師に昇格</button>
                 <button class="btn btn-archive btn-xsmall" data-admin-action="archive" data-uid="${escapeAttr(student.uid)}">🗑 削除</button>`}
            </td>
          </tr>`;
        }).join("")}
        </tbody>
      </table></div>`;
  }

  async function adminAction(action, uid) {
    const user = adminStudentsMap[uid] || adminTeachersMap[uid];
    if (!user) return;
    const messages = {
      archive: `「${user.name}」さんを削除（アーカイブ）しますか？\n\n・生徒一覧から外れます\n・この生徒はログインできなくなります（単語アプリなど、ハピクルの全アプリ共通）\n・学習データは残り、「📦 アーカイブ」表示でいつでも見られます\n・間違えたときは「在籍中に戻す」で元に戻せます`,
      restore: `「${user.name}」さんを在籍中に戻しますか？\n（生徒一覧に戻り、ログインもできるようになります）`,
      promote: `「${user.name}」さんを教師に昇格しますか？\n（管理画面へのアクセス権限が付与されます。ハピクルの全アプリ共通）`,
      demote: `「${user.name}」さんを生徒に戻しますか？\n（管理画面へのアクセス権限が失われます）`
    };
    if (action === "demote" && uid === currentUser?.uid) {
      window.alert("自分自身を降格させることはできません。");
      return;
    }
    if (!window.confirm(messages[action])) return;
    const patch = {
      archive: { archived: true },
      restore: { archived: false, archivedAt: null },
      promote: { role: "teacher" },
      demote: { role: "student" }
    }[action];
    try {
      if (localMode) {
        const users = getLocalUsers();
        Object.assign(users[uid], patch);
        setLocalUsers(users);
      } else {
        const data = { ...patch };
        if (action === "archive") data.archivedAt = firebase.firestore.FieldValue.serverTimestamp();
        await db.collection("users").doc(uid).set(data, { merge: true });
      }
      if (action === "promote") window.alert("教師に昇格しました。");
      if (action === "demote") window.alert("生徒に戻しました。");
      if (action === "promote" || action === "demote") {
        await loadAdminTeachers();
        await loadAdminStudents();
      } else {
        Object.assign(user, patch);
        renderAdminStudents();
      }
    } catch (error) {
      window.alert(permissionMessage(error));
    }
  }

  async function loadAdminTeachers() {
    const wrap = $("#admin-teachers-table-wrap");
    wrap.innerHTML = `<p class="loading-text">データを読み込み中...</p>`;
    $("#admin-teachers-stats-bar").innerHTML = "";
    try {
      const teachers = await fetchUsersByRole("teacher");
      teachers.sort((a, b) => (a.name || "").localeCompare(b.name || "", "ja"));
      adminTeachersAll = teachers;
      adminTeachersMap = {};
      teachers.forEach((teacher) => { adminTeachersMap[teacher.uid] = teacher; });
      const today = dateKey(new Date());
      $("#admin-teachers-stats-bar").innerHTML = `
        <div class="stat-item"><div class="stat-num">${teachers.length}</div><div class="stat-label">登録教師数</div></div>
        <div class="stat-item"><div class="stat-num">${teachers.filter((t) => activityCount(moduleOf(t).dailyLog[today]) > 0).length}</div><div class="stat-label">本日学習</div></div>`;
      renderAdminTeachers();
    } catch (error) {
      wrap.innerHTML = `<p class="form-error">読み込みエラー: ${escapeHtml(error.message)}<br>Firestoreのルール設定を確認してください。</p>`;
    }
  }

  function renderAdminTeachers() {
    const q = $("#admin-teacher-search").value.trim().toLowerCase();
    const teachers = adminTeachersAll.filter((t) => !q || (t.name || "").toLowerCase().includes(q) || (t.userId || "").toLowerCase().includes(q));
    const wrap = $("#admin-teachers-table-wrap");
    if (!teachers.length) {
      wrap.innerHTML = `<p class="loading-text">登録教師がいません。</p>`;
      return;
    }
    wrap.innerHTML = `
      <div class="admin-table-scroll">
      <table class="admin-table admin-table-narrow">
        <thead><tr>
          <th class="col-name">氏名</th><th class="col-id">ID</th><th class="col-pw">パスワード</th>
          <th class="col-total">✍️ 完了</th><th class="col-update">最終更新</th><th class="col-action">操作</th>
        </tr></thead>
        <tbody>
        ${teachers.map((teacher) => {
          const module = moduleOf(teacher);
          return `<tr>
            <td class="col-name col-name-link" data-open-user="${escapeAttr(teacher.uid)}" data-user-type="teacher"><strong>${escapeHtml(teacher.name || "—")}</strong></td>
            <td class="col-id">${escapeHtml(teacher.userId || "—")}</td>
            <td class="col-pw"><span class="pw-mask" data-pw="${escapeAttr(teacher.password || "（未登録）")}" data-visible="false">●●●●●●</span>
              <button class="btn-pw-toggle btn-pw-toggle-inline" data-inline-pw>表示</button></td>
            <td class="col-total">${module.essayCount ? `${module.essayCount}題` : "—"}</td>
            <td class="col-update">${module.lastActivityAt ? new Date(module.lastActivityAt).toLocaleDateString("ja-JP") : "—"}</td>
            <td class="col-action"><button class="btn btn-demote btn-xsmall" data-admin-action="demote" data-uid="${escapeAttr(teacher.uid)}">👤 生徒に戻す</button></td>
          </tr>`;
        }).join("")}
        </tbody>
      </table></div>`;
  }

  function toggleInlinePw(button) {
    const span = button.parentElement.querySelector(".pw-mask");
    if (!span) return;
    const visible = span.dataset.visible === "true";
    span.textContent = visible ? "●●●●●●" : span.dataset.pw;
    span.dataset.visible = visible ? "false" : "true";
    button.textContent = visible ? "表示" : "隠す";
  }

  // 教師アカウントの作成（今の管理者ログインのまま）。書類は新しい教師本人の権限で作る
  async function createTeacher() {
    const name = $("#create-teacher-name").value.trim();
    const tid = $("#create-teacher-id").value.trim();
    const password = $("#create-teacher-password").value;
    const button = $("#btn-create-teacher");
    clearError("create-teacher-error");
    if (!name) return showError("create-teacher-error", "お名前を入力してください。");
    if (!tid) return showError("create-teacher-error", "IDを入力してください。");
    if (password.length < 6) return showError("create-teacher-error", "パスワードは6文字以上で入力してください。");
    try {
      button.disabled = true;
      button.textContent = "作成中...";
      if (localMode) {
        const users = getLocalUsers();
        users[`local_${tid}`] = { uid: `local_${tid}`, name, userId: tid, password, role: "teacher" };
        setLocalUsers(users);
      } else {
        const secApp = getSecondaryApp();
        const credential = await secApp.auth().createUserWithEmailAndPassword(idToEmail(tid), password);
        await secApp.firestore().collection("users").doc(credential.user.uid).set({
          name, userId: tid, password, role: "teacher", records_ex: {}, records_pastan: {},
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        await secApp.auth().signOut();
      }
      $("#create-teacher-name").value = "";
      $("#create-teacher-id").value = "";
      $("#create-teacher-password").value = "";
      $("#admin-create-teacher-details").open = false;
      window.alert(`教師「${name}」を作成しました。`);
      loadAdminTeachers();
    } catch (error) {
      showError("create-teacher-error", error.code ? authErrorMsg(error.code) : permissionMessage(error));
    } finally {
      button.disabled = false;
      button.textContent = "作成する";
    }
  }

  function renderAdminTopics() {
    const q = $("#admin-topic-search").value.trim().toLowerCase();
    const list = TOPICS.filter((topic) => !q || `${topic.label} ${topic.en} ${topic.ja} ${topic.points.join(" ")}`.toLowerCase().includes(q));
    $("#admin-topic-count").textContent = `${list.length} / ${TOPICS.length} 件`;
    $("#admin-topic-list-wrap").innerHTML = `
      <div class="admin-table-scroll">
      <table class="admin-table admin-table-topics">
        <thead><tr><th class="col-id">年度・回</th><th class="col-name">TOPIC</th><th class="col-name">POINTS</th><th class="col-id">出典</th></tr></thead>
        <tbody>
        ${list.map((topic) => `<tr>
          <td class="col-id">${escapeHtml(topic.label)}</td>
          <td class="col-name"><strong>${escapeHtml(topic.en)}</strong><br><small>${escapeHtml(topic.ja)}</small></td>
          <td class="col-name"><small>${topic.points.map((p, i) => `${escapeHtml(p)}（${escapeHtml((topic.pointsJa || [])[i] || "")}）`).join("<br>")}</small></td>
          <td class="col-id"><small>${escapeHtml(topic.check || "")}</small>${topic.source && /^https?:/.test(topic.source) ? `<br><a href="${escapeAttr(topic.source)}" target="_blank" rel="noopener">出典</a>` : ""}</td>
        </tr>`).join("")}
        </tbody>
      </table></div>`;
  }

  function manualHtml() {
    return `<div class="manual">
      <h3>このアプリでできること</h3>
      <p>生徒は、英検準1級の英作文（大問5）を「理由を日本語で6文 → AIが日本語を整える → 英語にする → 全文が出る」の順で書きます。1段落目と4段落目はAIが田中先生の型どおりに作ります。書き上げた全文は生徒の「学習データ」のノートにたまります。</p>
      <h3>生徒一覧の見方</h3>
      <ul>
        <li><b>✍️ 完了</b>：全文まで書き上げた題数　<b>書きかけ</b>：途中で止まっている題数</li>
        <li><b>今日</b>：今日書き上げた題数（✎は日本語の添削だけした回数）</li>
        <li><b>平均語数</b>：書き上げた全文の平均（英検の目安は120〜150語）</li>
        <li><b>🔥 連続</b>：日本語の添削か全文を、続けて取り組んだ日数</li>
        <li>見出しを押すと並べ替えられます。氏名を押すと、カレンダー・グラフ・書いた英作文・履歴とID・パスワードが見られます</li>
        <li>英作文を1回もやっていない生徒は初めは隠しています。「やっていない生徒も表示」で出せます</li>
      </ul>
      <h3>単語アプリと共通のもの</h3>
      <p>ID・パスワード・名前・教師かどうか・アーカイブ（削除）は、単語アプリなどハピクルの全アプリで共通です。ここで「削除」や「教師に昇格」をすると、単語アプリにも同じように反映されます。</p>
      <h3>AIの添削について</h3>
      <p>AIの添削は1人1日30回（15題ぶん）までです。AIの説明で分からない所は、生徒が全文をコピーして先生にLINEで質問する流れにしています。</p>
    </div>`;
  }

  // 生徒詳細（教師用）：ID・PW・カレンダー・グラフ・英作文・履歴
  function getDetailUser() {
    const map = detailType === "teacher" ? adminTeachersMap : adminStudentsMap;
    return map[detailUid] || null;
  }

  function openUserDetail(uid, type) {
    detailType = type === "teacher" ? "teacher" : "student";
    detailUid = uid;
    const user = getDetailUser();
    if (!user) return;
    adminCalViewDate = new Date();
    detailRecords = [];
    const prefix = detailType === "teacher" ? "🏫 " : user.archived ? "📦 " : "";
    $("#detail-student-name").textContent = prefix + (user.name || "—");
    $("#detail-student-id").textContent = user.userId || "—";
    const pw = $("#detail-student-pw");
    pw.textContent = "●●●●●●";
    pw.dataset.pw = user.password || "（未登録）";
    pw.dataset.visible = "false";
    $("#btn-pw-toggle").textContent = "表示";
    user.dailyLog = moduleOf(user).dailyLog || {};
    user.historyLog = moduleOf(user).historyLog || [];
    renderDetailTab("calendar");
    openModal("student-detail-modal");
  }

  function toggleDetailPw() {
    const pw = $("#detail-student-pw");
    const visible = pw.dataset.visible === "true";
    pw.textContent = visible ? "●●●●●●" : pw.dataset.pw;
    pw.dataset.visible = visible ? "false" : "true";
    $("#btn-pw-toggle").textContent = visible ? "表示" : "隠す";
  }

  async function renderDetailTab(tab) {
    const user = getDetailUser();
    if (!user) return;
    detailTab = tab;
    $$("[data-detail-tab]").forEach((button) => button.classList.toggle("active", button.dataset.detailTab === tab));
    const body = $("#detail-body");
    body.innerHTML = "";
    if (tab === "calendar") renderCalendarView(user.dailyLog || {}, body, "detail");
    if (tab === "chart") renderLineChart(user.dailyLog || {}, body);
    if (tab === "history") renderHistory(user.historyLog || [], body, "detail");
    if (tab === "notes") {
      body.innerHTML = `<p class="loading-text">読み込み中...</p>`;
      try {
        if (localMode) detailRecords = (readLocalData(user.uid).records || []).map(normalizeRecord);
        else {
          const snapshot = await recordsColRef(user.uid).get();
          detailRecords = snapshot.docs.map((doc) => normalizeRecord({ id: doc.id, ...doc.data() }));
        }
        sortRecords(detailRecords);
        if (detailTab === "notes") body.innerHTML = `<div class="record-list">${notesListHtml(detailRecords, "detail")}</div>`;
      } catch (error) {
        body.innerHTML = `<p class="form-error">読み込めませんでした（${escapeHtml(error.code || error.message)}）。データベースのルール設定を確認してください。</p>`;
      }
    }
  }

  // ===== フレーズを覚える（単語アプリの暗記の仕組みを写した） =====
  // セクション（20個ずつ）→ モード選択（本番テスト・バツ練習・マグレ練習・フラッシュカード）→ 4択／カード。
  // 決まりは単語アプリと同じ：本番は毎回そのセクションの全問を通しで解き、1回で全問正解すると合格（🏆）。
  // 2周目以降は🔀ランダムで全問正解したときだけ合格に数える。練習は点数に入らず、正解すると「残りのバツ」から外れる。
  // 記録はモジュールの書類（users/{uid}/modules/writing）の phrase に置く。
  const PHRASE_SECTION_SIZE = 20;
  const PHRASE_SECTIONS = (() => {
    const list = [];
    for (let i = 0; i < PHRASES.length; i += PHRASE_SECTION_SIZE) {
      const items = PHRASES.slice(i, i + PHRASE_SECTION_SIZE);
      list.push({ id: `p${list.length + 1}`, label: `セクション${list.length + 1}`, range: `No.${items[0].no}〜${items[items.length - 1].no}`, nos: items.map((p) => p.no) });
    }
    return list;
  })();
  const PHRASE_MODE_NAMES = { normal: "本番テスト", review: "⭐ バツ練習", lucky: "🔺 マグレ練習", "review-combined": "⭐🔺 バツ＋マグレ練習", flashcard: "🃏 フラッシュカード" };
  const pq = { section: null, mode: "normal", order: "random", orderMode: "random", pool: [], all: [], current: null, answered: false, recorded: false, run: null, round: 1, sessionCorrect: 0, sessionWrong: 0, totalPool: 0, choices: [] };
  const pfc = { section: null, mode: "all", pool: [], index: 0, total: 0, unknown: new Set(), tab: "en", counted: false, logged: false };
  let phraseCompleteType = "quiz";

  function emptyPhraseState() {
    return { records: {}, sections: {}, fc: { sessions: 0, cards: 0, lastDate: "" } };
  }
  function normalizePhraseState(input) {
    const p = input && typeof input === "object" ? input : {};
    return {
      records: p.records && typeof p.records === "object" ? p.records : {},
      sections: p.sections && typeof p.sections === "object" ? p.sections : {},
      fc: { sessions: 0, cards: 0, lastDate: "", ...(p.fc || {}) }
    };
  }
  function phraseByNo(no) { return PHRASES.find((p) => p.no === Number(no)); }
  function phraseSection(id) { return PHRASE_SECTIONS.find((s) => s.id === id); }
  function phraseRec(no) {
    const recs = moduleState.phrase.records;
    if (!recs[no]) recs[no] = { correct: false, attempts: 0, wrongCount: 0, lucky: false };
    return recs[no];
  }
  const pIsEverWrong = (r) => (r?.wrongCount || 0) > 0;
  const pIsRemainWrong = (r) => pIsEverWrong(r) && !r.practiceOk;
  const pIsRemainLucky = (r) => r?.lucky === true;

  // セクション1つぶんの数字（単語アプリの sectionInfo と同じ考え方）
  function phraseSectionInfo(sec, phraseState = moduleState.phrase) {
    const st = phraseState.sections[sec.id] || {};
    const info = { total: sec.nos.length, correct: 0, answered: 0, everWrong: 0, remainWrong: 0, remainLucky: 0 };
    sec.nos.forEach((no) => {
      const r = phraseState.records[no];
      if (!r) return;
      if (r.correct) info.correct += 1;
      if ((r.attempts || 0) > 0) info.answered += 1;
      if (pIsEverWrong(r)) info.everWrong += 1;
      if (pIsRemainWrong(r)) info.remainWrong += 1;
      if (pIsRemainLucky(r)) info.remainLucky += 1;
    });
    info.hasRun = st.lastScore != null;
    info.score = info.hasRun ? st.lastScore : 0;
    info.best = st.bestScore != null ? st.bestScore : null;
    info.cleared = info.total > 0 && info.score === info.total;
    info.passCount = st.passCount || 0;
    info.passes = st.passes || [];
    info.seqFull = st.seqFullCount || 0;
    info.round = info.hasRun ? (st.lastRunRound || 1) : 1;
    info.nextRound = info.passCount + 1;
    return info;
  }
  function phraseCellClass(info) {
    if (info.round >= 2) return info.cleared ? "cell-r2-full" : "cell-r2-part";
    const pct = info.total ? (info.score / info.total) * 100 : 0;
    return info.cleared ? "cell-perfect" : pct >= 80 ? "cell-good" : pct >= 50 ? "cell-mid" : pct > 0 ? "cell-low" : "cell-none";
  }
  function phrasePassBadge(info) {
    let html = info.passCount > 0 ? `<span class="pass-badge" title="合格回数">🏆${info.passCount}</span>` : "";
    if (info.round >= 2) html += `<span class="round-badge">${info.round}周目</span>`;
    return html;
  }
  const phraseOrderName = (order) => (order === "sequential" ? "📋 順番通り" : "🔀 ランダム");
  const phraseOrderIcon = (order) => (order === "sequential" ? "📋" : "🔀");

  // 書くタブの「フレーズを覚える！」のカード（例題の前）
  function phraseCardHtml() {
    if (!PHRASES.length) return "";
    const infos = PHRASE_SECTIONS.map((sec) => phraseSectionInfo(sec));
    const cleared = infos.filter((info) => info.passCount > 0).length;
    const wrong = infos.reduce((sum, info) => sum + info.remainWrong, 0);
    return `
      <article class="topic-card phrase-card">
        <div class="topic-card-head">
          <span class="phrase-badge">暗記</span>
          ${cleared ? `<span class="badge badge-done">合格 ${cleared}/${PHRASE_SECTIONS.length}セクション</span>` : ""}
          ${wrong ? `<span class="badge badge-draft">残りのバツ ${wrong}</span>` : ""}
        </div>
        <h3>フレーズを覚える！</h3>
        <p class="topic-ja">田中先生のおすすめフレーズ${PHRASES.length}。単語アプリと同じ4択テストとフラッシュカードで覚えよう。</p>
        <div class="topic-actions">
          <button class="btn btn-primary btn-small" data-phrase-home>覚える</button>
        </div>
      </article>`;
  }

  function openPhraseHome() {
    $("#phrase-section-grid").innerHTML = PHRASE_SECTIONS.map((sec) => {
      const info = phraseSectionInfo(sec);
      return `<div class="section-card${info.cleared ? " cleared" : ""}${info.round >= 2 ? " round2" : ""}" data-phrase-section="${sec.id}">
        <div class="card-title">${sec.label}${info.cleared ? " ✅" : ""}</div>
        <div class="card-range">${sec.range}</div>
        <div class="card-progress"><span class="card-score ${phraseCellClass(info)}">${info.score}/${info.total} 点</span></div>
        ${info.best != null && info.best > info.score ? `<div class="card-progress card-best">最高 ${info.best}点</div>` : ""}
        ${info.passCount > 0 || info.round >= 2 ? `<div class="card-progress card-badges">${phrasePassBadge(info)}</div>` : ""}
        ${info.remainWrong > 0 ? `<div class="card-progress" style="color:#E05555">残りのバツ ${info.remainWrong} 個</div><div class="card-badge">✗</div>` : ""}
      </div>`;
    }).join("");
    showScreen("screen-phrase-home");
  }

  function phraseResumeKey() { return `hwa_phrase_resume_${currentUser ? currentUser.uid : "guest"}`; }
  function getSavedPhraseQuiz() {
    try { return JSON.parse(localStorage.getItem(phraseResumeKey())); } catch (error) { return null; }
  }

  function openPhraseMode(secId) {
    const sec = phraseSection(secId);
    if (!sec) return;
    pq.section = sec;
    const info = phraseSectionInfo(sec);
    const recs = moduleState.phrase.records;
    const wrongN = sec.nos.filter((no) => pIsRemainWrong(recs[no])).length;
    const luckyN = sec.nos.filter((no) => pIsRemainLucky(recs[no])).length;
    const combinedN = sec.nos.filter((no) => pIsRemainWrong(recs[no]) || pIsRemainLucky(recs[no])).length;
    const fcReviewN = sec.nos.filter((no) => pIsRemainWrong(recs[no]) || recs[no]?.fcUnknown === true).length;
    $("#phrase-mode-title").textContent = `${sec.label}（${sec.range}）`;
    $("#phrase-mode-stats").innerHTML = `
      <strong>本番の点数:</strong> <span class="${phraseCellClass(info)} mode-score">${info.score}/${info.total}</span>
      ${info.best != null && info.best > info.score ? `<span class="mode-best">最高 ${info.best}</span>` : ""}
      ${phrasePassBadge(info)}<br>
      <strong>残りのバツ:</strong> ${wrongN} 個（これまで ${info.everWrong} 個）／
      <strong>残りのマグレ:</strong> ${luckyN} 個<br>
      <span class="mode-note">次の本番は${info.nextRound}周目。全${info.total}問を通しで解き、1回で全問正解すると合格${info.nextRound >= 2 ? "（2周目以降はランダムでクリアしたときだけ合格に数えます）" : ""}</span>`;
    $("#btn-phrase-normal").textContent = `▶ 本番テスト（全${info.total}問を通しで）`;
    [["#btn-phrase-review", wrongN], ["#btn-phrase-lucky", luckyN], ["#btn-phrase-combined", combinedN], ["#btn-phrase-fc-review", fcReviewN]].forEach(([sel, n]) => {
      $(sel).disabled = n === 0;
    });
    const saved = getSavedPhraseQuiz();
    const resume = $("#btn-phrase-resume");
    if (saved && saved.sectionId === sec.id) {
      resume.classList.remove("hidden");
      resume.textContent = saved.mode === "normal"
        ? `⏸ 本番の続きから（あと${saved.poolNos.length}問・${phraseOrderName(saved.order)}）`
        : `⏸ 練習の続きから（${PHRASE_MODE_NAMES[saved.mode] || "練習"}・あと${saved.poolNos.length}問）`;
    } else {
      resume.classList.add("hidden");
    }
    updatePhraseOrderWarn();
    showScreen("screen-phrase-mode");
  }

  function setPhraseOrder(order) {
    pq.orderMode = order;
    $$("[data-phrase-order]").forEach((button) => button.classList.toggle("active", button.dataset.phraseOrder === order));
    updatePhraseOrderWarn();
  }
  function updatePhraseOrderWarn() {
    const show = pq.section && pq.orderMode === "sequential" && phraseSectionInfo(pq.section).nextRound >= 2;
    $("#phrase-order-warn").classList.toggle("hidden", !show);
  }

  function shufflePhrases(list) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function applyPhraseOrder(list, order) {
    return order === "sequential" ? [...list].sort((a, b) => a.no - b.no) : shufflePhrases(list);
  }

  function startPhraseQuiz(mode) {
    const sec = pq.section;
    const all = sec.nos.map(phraseByNo);
    const recs = moduleState.phrase.records;
    const saved = getSavedPhraseQuiz();
    const savedHere = saved && saved.sectionId === sec.id;
    if (mode === "normal") {
      if (savedHere && saved.mode === "normal" &&
        !window.confirm(`途中の本番があります（あと${saved.poolNos.length}問）。\n最初からやり直すと、途中の回は「途中でやめた回」として履歴に残り、点数は付きません。\n最初からやり直しますか？`)) return;
      if (pq.orderMode === "sequential" && phraseSectionInfo(sec).nextRound >= 2 &&
        !window.confirm("2周目以降の合格扱いになるには、ランダムでクリアする必要があります。順番通りで解いた分は、合格回数（🏆）に数えません。\n順番通りで始めますか？")) return;
    }
    localStorage.removeItem(phraseResumeKey());
    Object.assign(pq, { mode, order: pq.orderMode, sessionCorrect: 0, sessionWrong: 0, answered: false, all, run: null });
    if (mode === "review") pq.pool = applyPhraseOrder(all.filter((p) => pIsRemainWrong(recs[p.no])), pq.order);
    else if (mode === "lucky") pq.pool = applyPhraseOrder(all.filter((p) => pIsRemainLucky(recs[p.no])), pq.order);
    else if (mode === "review-combined") pq.pool = applyPhraseOrder(all.filter((p) => pIsRemainWrong(recs[p.no]) || pIsRemainLucky(recs[p.no])), pq.order);
    else {
      pq.pool = applyPhraseOrder(all, pq.order);
      pq.round = phraseSectionInfo(sec).nextRound;
      pq.run = { id: Date.now(), resumed: 0, correct: [], wrong: [] };
    }
    if (!pq.pool.length) { showToast("出題できるフレーズがありません"); return; }
    pq.totalPool = pq.pool.length;
    showScreen("screen-phrase-quiz");
    setPhraseQuizLabel();
    nextPhraseQuestion();
  }

  function setPhraseQuizLabel() {
    $("#phrase-quiz-section").textContent = `${pq.section.label}（${pq.section.range}）`;
    $("#phrase-quiz-mode").innerHTML = pq.mode === "normal"
      ? `本番テスト ${pq.round}周目 ${phraseOrderIcon(pq.order)}${pq.order === "sequential" && pq.round >= 2 ? '<span class="quiz-warn">順番通り（合格に数えません）</span>' : ""}`
      : `${escapeHtml(PHRASE_MODE_NAMES[pq.mode] || "練習")}（点数に入りません） ${phraseOrderIcon(pq.order)}`;
  }

  function nextPhraseQuestion() {
    if (!pq.pool.length) { showPhraseComplete(); return; }
    pq.current = pq.pool.shift();
    pq.answered = false;
    pq.recorded = false;
    const isNormal = pq.mode === "normal" && pq.run;
    const total = isNormal ? pq.all.length : pq.totalPool;
    const done = isNormal ? pq.run.correct.length + pq.run.wrong.length : pq.sessionCorrect + pq.sessionWrong;
    $("#phrase-progress-bar").style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
    $("#phrase-progress-text").textContent = isNormal ? `${done} / ${total}　点数 ${total - pq.run.wrong.length}/${total}` : `${done} / ${total}`;
    $("#phrase-display").textContent = pq.current.en;
    $("#phrase-no").textContent = `No.${pq.current.no}`;
    const others = shufflePhrases(pq.all.filter((p) => p.no !== pq.current.no && p.ja !== pq.current.ja));
    const extra = shufflePhrases(PHRASES.filter((p) => !pq.section.nos.includes(p.no) && p.ja !== pq.current.ja));
    pq.choices = shufflePhrases([pq.current.ja, ...[...others, ...extra].slice(0, 3).map((p) => p.ja)]);
    $("#phrase-choices").innerHTML = pq.choices.map((choice, i) => `<button class="choice-btn" data-phrase-choice="${i}">${escapeHtml(choice)}</button>`).join("");
    const result = $("#phrase-result");
    result.className = "quiz-result hidden";
    result.innerHTML = "";
    $("#phrase-next").innerHTML = "";
    $("#phrase-next").classList.add("hidden");
  }

  function onPhraseAnswer(index) {
    if (pq.answered) return;
    pq.answered = true;
    const chosen = pq.choices[index];
    const correct = pq.current.ja;
    const isCorrect = chosen === correct;
    $$("#phrase-choices .choice-btn").forEach((button, i) => {
      button.disabled = true;
      if (pq.choices[i] === correct) button.classList.add("correct");
      else if (i === index && !isCorrect) button.classList.add("wrong");
    });
    const result = $("#phrase-result");
    result.className = `quiz-result ${isCorrect ? "correct-msg" : "wrong-msg"}`;
    result.innerHTML = isCorrect
      ? `⭕ 正解！<div class="result-word-info">${escapeHtml(pq.current.en)} = ${escapeHtml(correct)}</div>`
      : `✗ 不正解 — 正解：<strong>${escapeHtml(correct)}</strong><div class="result-word-info">${escapeHtml(pq.current.en)}</div>`;
    const next = $("#phrase-next");
    next.classList.remove("hidden");
    if (isCorrect) {
      pq.sessionCorrect += 1;
      next.innerHTML = `<div class="quiz-next-correct">
        <button class="btn btn-primary quiz-next-btn" data-phrase-confirm="sure">⭕ 確信して正解</button>
        <button class="btn btn-lucky quiz-next-btn" data-phrase-confirm="lucky">🔺 マグレの正解</button></div>`;
    } else {
      const r = phraseRec(pq.current.no);
      r.attempts += 1;
      r.wrongCount = (r.wrongCount || 0) + 1;
      r.practiceOk = false;
      r.lucky = false;
      if (pq.mode === "normal" && pq.run) pq.run.wrong.push(pq.current.no);
      pq.sessionWrong += 1;
      pq.recorded = true;
      bumpPhraseDaily();
      persistModule().catch((error) => console.warn("phrase not saved", error));
      next.innerHTML = `<button class="btn btn-secondary quiz-next-btn" data-phrase-next>次へ →</button>`;
    }
  }

  function confirmPhraseAnswer(isLucky) {
    const r = phraseRec(pq.current.no);
    r.attempts += 1;
    r.lucky = isLucky;
    if (isLucky) r.luckyCount = (r.luckyCount || 0) + 1;
    if (pq.mode === "normal" && pq.run) pq.run.correct.push(pq.current.no);
    else r.practiceOk = true;
    pq.recorded = true;
    bumpPhraseDaily();
    persistModule().catch((error) => console.warn("phrase not saved", error));
    nextPhraseQuestion();
  }

  // 1日ごとの記録：フレーズを解いた数・カードをめくった数
  function bumpPhraseDaily() {
    const day = dateKey(new Date());
    const entry = moduleState.dailyLog[day] || { ja: 0, done: 0, words: 0 };
    entry.phrase = (entry.phrase || 0) + 1;
    moduleState.dailyLog[day] = entry;
    moduleState.lastActivityAt = new Date().toISOString();
  }
  function pushPhraseHistory(detail) {
    moduleState.historyLog.unshift({ at: new Date().toISOString(), type: "phrase", label: `フレーズ ${pq.section ? pq.section.label : ""}`, ...detail });
    moduleState.historyLog = moduleState.historyLog.slice(0, HISTORY_MAX);
  }

  function savePhraseQuizAndBack() {
    const remaining = pq.current && !pq.recorded ? [pq.current, ...pq.pool] : pq.pool;
    if (remaining.length) {
      localStorage.setItem(phraseResumeKey(), JSON.stringify({
        sectionId: pq.section.id, mode: pq.mode, order: pq.order, round: pq.round, run: pq.run,
        poolNos: remaining.map((p) => p.no), totalPool: pq.totalPool, sessionCorrect: pq.sessionCorrect, sessionWrong: pq.sessionWrong
      }));
    }
    const answered = pq.mode === "normal" && pq.run ? pq.run.correct.length + pq.run.wrong.length : pq.sessionCorrect + pq.sessionWrong;
    if (answered > 0) {
      pushPhraseHistory({ mode: pq.mode, status: "paused", answered, correct: pq.mode === "normal" && pq.run ? pq.run.correct.length : pq.sessionCorrect, total: pq.mode === "normal" ? pq.all.length : pq.totalPool });
      persistModule().catch(() => {});
    }
    openPhraseMode(pq.section.id);
  }

  function resumePhraseQuiz() {
    const saved = getSavedPhraseQuiz();
    if (!saved) return;
    const sec = phraseSection(saved.sectionId);
    localStorage.removeItem(phraseResumeKey());
    if (!sec) return;
    Object.assign(pq, {
      section: sec, mode: saved.mode, order: saved.order || "random", round: saved.round || 1, run: saved.run || null,
      sessionCorrect: saved.sessionCorrect || 0, sessionWrong: saved.sessionWrong || 0, answered: false,
      all: sec.nos.map(phraseByNo), pool: saved.poolNos.map(phraseByNo).filter(Boolean)
    });
    if (pq.run) pq.run.resumed = (pq.run.resumed || 0) + 1;
    pq.totalPool = saved.totalPool || pq.pool.length;
    if (!pq.pool.length) { openPhraseMode(sec.id); return; }
    showScreen("screen-phrase-quiz");
    setPhraseQuizLabel();
    nextPhraseQuestion();
  }

  function showPhraseComplete() {
    phraseCompleteType = "quiz";
    localStorage.removeItem(phraseResumeKey());
    let title = "練習おわり！";
    let body = "";
    if (pq.mode === "normal" && pq.run) {
      const total = pq.all.length;
      const ok = new Set(pq.run.correct);
      pq.all.forEach((p) => { phraseRec(p.no).correct = ok.has(p.no); });
      const score = pq.run.correct.length;
      const st = moduleState.phrase.sections[pq.section.id] || (moduleState.phrase.sections[pq.section.id] = {});
      st.lastScore = score;
      st.bestScore = Math.max(st.bestScore || 0, score);
      st.lastRunRound = pq.round;
      st.lastRunAt = new Date().toISOString();
      st.runs = (st.runs || 0) + 1;
      let status = "done";
      let passLine;
      if (score === total && (pq.round === 1 || pq.order === "random")) {
        st.passCount = (st.passCount || 0) + 1;
        st.passes = [...(st.passes || []), { date: dateKey(new Date()), round: pq.round, order: pq.order, score, resumed: pq.run.resumed || 0 }];
        status = "pass";
        title = "🎉 合格！";
        passLine = `<strong style="color:#FF6B9D">🏆 ${st.passCount}回目の合格！（${phraseOrderName(pq.order)}）</strong>`;
      } else if (score === total) {
        st.seqFullCount = (st.seqFullCount || 0) + 1;
        status = "seqFull";
        title = "満点！";
        passLine = `<span class="complete-warn">⚠️ 2周目以降の合格扱いになるには、ランダムでクリアする必要があります。<br>今回の満点は記録に残りますが、合格回数は増えません。</span>`;
      } else {
        title = "本番テスト終了";
        passLine = `<span class="mode-note">あと${total - score}問で満点。1回のテストで全問正解すると合格です。<br>間違えたフレーズは「バツ練習」で練習しましょう。</span>`;
      }
      pushPhraseHistory({ mode: "normal", status, round: pq.round, order: pq.order, answered: total, correct: score, total });
      body = `<strong>今回の点数:</strong> ${score}/${total}（${pq.round}周目・${phraseOrderName(pq.order)}）<br>
        ${st.bestScore > score ? `<strong>最高:</strong> ${st.bestScore}/${total}<br>` : ""}${passLine}`;
    } else {
      const answered = pq.sessionCorrect + pq.sessionWrong;
      const pct = answered ? Math.round((pq.sessionCorrect / answered) * 100) : 0;
      pushPhraseHistory({ mode: pq.mode, status: "done", answered, correct: pq.sessionCorrect, total: pq.totalPool });
      const info = phraseSectionInfo(pq.section);
      body = `<strong>今回の正答率:</strong> ${pq.sessionCorrect}/${answered}（${pct}%）<br>
        <strong>本番の点数:</strong> ${info.score}/${info.total}（練習では変わりません）<br>
        <span class="mode-note">練習の結果は、本番の点数と合格には入りません。正解したフレーズは「残りのバツ」から外れます。</span>`;
    }
    persistModule().catch((error) => console.warn("phrase not saved", error));
    $("#phrase-complete-title").textContent = title;
    $("#phrase-complete-stats").innerHTML = body;
    $("#btn-phrase-retry").textContent = pq.mode === "normal" ? "もう一度（最初から通しで）" : "もう一度";
    $("#btn-phrase-retry-unknown").classList.add("hidden");
    showScreen("screen-phrase-complete");
  }

  // フラッシュカード
  function startPhraseFlashcard(mode) {
    const sec = pq.section;
    const recs = moduleState.phrase.records;
    const all = sec.nos.map(phraseByNo);
    const raw = mode === "review" ? all.filter((p) => pIsRemainWrong(recs[p.no]) || recs[p.no]?.fcUnknown === true) : all;
    Object.assign(pfc, { section: sec, mode, pool: applyPhraseOrder(raw, pq.orderMode), index: 0, unknown: new Set(), counted: false, logged: false });
    if (!pfc.pool.length) { showToast("出題できるフレーズがありません"); return; }
    pfc.total = pfc.pool.length;
    $("#phrase-fc-section").textContent = `${sec.label}（${sec.range}）`;
    showScreen("screen-phrase-fc");
    renderPhraseCard();
  }
  function renderPhraseCard() {
    if (pfc.index >= pfc.pool.length) { showPhraseFcComplete(); return; }
    pfc.current = pfc.pool[pfc.index];
    $("#phrase-fc-progress").style.width = `${Math.round((pfc.index / pfc.total) * 100)}%`;
    $("#phrase-fc-counter").textContent = `${pfc.index + 1} / ${pfc.total}`;
    $("#phrase-fc-no").textContent = `No.${pfc.current.no}`;
    renderPhraseCardContent();
  }
  function renderPhraseCardContent() {
    $$("[data-phrase-tab]").forEach((tab) => tab.classList.toggle("active", tab.dataset.phraseTab === pfc.tab));
    const main = $("#phrase-fc-main");
    main.className = pfc.tab === "en" ? "fc-word-en" : "fc-word-ja";
    main.textContent = pfc.tab === "en" ? pfc.current.en : pfc.current.ja;
  }
  function markPhraseCard(known) {
    if (!known) pfc.unknown.add(pfc.current.no);
    phraseRec(pfc.current.no).fcUnknown = !known;
    const fc = moduleState.phrase.fc;
    if (!pfc.counted) { pfc.counted = true; fc.sessions = (fc.sessions || 0) + 1; }
    fc.cards = (fc.cards || 0) + 1;
    fc.lastDate = dateKey(new Date());
    bumpPhraseDaily();
    persistModule().catch((error) => console.warn("phrase not saved", error));
    pfc.index += 1;
    renderPhraseCard();
  }
  function logPhraseFlashcard(status) {
    if (!pfc.section || pfc.index === 0 || pfc.logged) return;
    pfc.logged = true;
    pq.section = pfc.section;
    pushPhraseHistory({ mode: "flashcard", status, answered: pfc.index, correct: pfc.index - pfc.unknown.size, total: pfc.total });
    persistModule().catch(() => {});
  }
  function showPhraseFcComplete() {
    phraseCompleteType = "flashcard";
    logPhraseFlashcard("done");
    const unknown = pfc.unknown.size;
    $("#phrase-complete-title").textContent = "🃏 フラッシュカード完了！";
    $("#phrase-complete-stats").innerHTML = `<strong>わかった:</strong> ${pfc.total - unknown} 個<br><strong>わからない:</strong> ${unknown} 個<br><strong>合計:</strong> ${pfc.total} 個`;
    $("#btn-phrase-retry").textContent = "もう一度（全部）";
    const retryUnknown = $("#btn-phrase-retry-unknown");
    retryUnknown.textContent = `⭐ わからない ${unknown} 個をもう一度`;
    retryUnknown.classList.toggle("hidden", unknown === 0);
    showScreen("screen-phrase-complete");
  }
  function retryPhraseUnknown() {
    const list = pfc.pool.filter((p) => pfc.unknown.has(p.no));
    if (!list.length) return;
    Object.assign(pfc, { pool: applyPhraseOrder(list, pq.orderMode), index: 0, unknown: new Set(), counted: false, logged: false });
    pfc.total = pfc.pool.length;
    showScreen("screen-phrase-fc");
    renderPhraseCard();
  }

  // 発音（端末の読み上げ。〜や・・・は読まない）
  function speakPhrase(text) {
    if (!("speechSynthesis" in window)) return;
    const clean = String(text || "").replace(/[～~〜・…]+/g, " ").replace(/人/g, "someone").replace(/\s+/g, " ").trim();
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(clean);
    utter.lang = "en-US";
    utter.rate = 0.9;
    window.speechSynthesis.speak(utter);
  }

  // フレーズの画面のボタン（まとめて受ける）
  function handlePhraseClick(target) {
    if (target.closest("[data-phrase-home]")) { openPhraseHome(); return true; }
    const sec = target.closest("[data-phrase-section]");
    if (sec) { openPhraseMode(sec.dataset.phraseSection); return true; }
    const order = target.closest("[data-phrase-order]");
    if (order) { setPhraseOrder(order.dataset.phraseOrder); return true; }
    const start = target.closest("[data-phrase-start]");
    if (start && !start.disabled) { startPhraseQuiz(start.dataset.phraseStart); return true; }
    const fcStart = target.closest("[data-phrase-fc]");
    if (fcStart && !fcStart.disabled) { startPhraseFlashcard(fcStart.dataset.phraseFc); return true; }
    if (target.closest("[data-phrase-resume]")) { resumePhraseQuiz(); return true; }
    const choice = target.closest("[data-phrase-choice]");
    if (choice) { onPhraseAnswer(Number(choice.dataset.phraseChoice)); return true; }
    const confirmButton = target.closest("[data-phrase-confirm]");
    if (confirmButton) { confirmPhraseAnswer(confirmButton.dataset.phraseConfirm === "lucky"); return true; }
    if (target.closest("[data-phrase-next]")) { nextPhraseQuestion(); return true; }
    if (target.closest("[data-phrase-quiz-back]")) { savePhraseQuizAndBack(); return true; }
    if (target.closest("[data-phrase-fc-back]")) { logPhraseFlashcard("paused"); openPhraseMode(pfc.section.id); return true; }
    if (target.closest("[data-phrase-speak]")) { speakPhrase(pq.current?.en); return true; }
    if (target.closest("[data-phrase-fc-speak]")) { speakPhrase(pfc.current?.en); return true; }
    const tab = target.closest("[data-phrase-tab]");
    if (tab) { pfc.tab = tab.dataset.phraseTab; renderPhraseCardContent(); return true; }
    const mark = target.closest("[data-phrase-mark]");
    if (mark) { markPhraseCard(mark.dataset.phraseMark === "known"); return true; }
    if (target.closest("#btn-phrase-retry")) {
      if (phraseCompleteType === "flashcard") startPhraseFlashcard(pfc.mode);
      else startPhraseQuiz(pq.mode);
      return true;
    }
    if (target.closest("#btn-phrase-retry-unknown")) { retryPhraseUnknown(); return true; }
    if (target.closest("[data-phrase-to-sections]")) { openPhraseHome(); return true; }
    return false;
  }

  // ===== 使い方・フレーズ =====
  function renderTutorial() {
    const steps = [
      ["トピックを選ぶ", "英検準1級の過去問から選びます。"],
      ["理由を日本語で6文", "賛成か反対かを決めて、理由を2つ。理由ごとにPOINTを1つ選び、3文ずつ書きます（理由→具体例→まとめ）。"],
      ["AIが日本語を整える", "中学で習う文法で英語にできる日本語に直します。どの文法で書くかを見越した理由もコメントで返ってきます。"],
      ["英語にする", "直った日本語を見ながら、6文を英語にして送信します。"],
      ["全文が出る", "1段落目と4段落目はアプリが型どおりに作ります。全文は「学習データ」のノートにたまるので、覚えて授業へ。分からない所はコピーして先生にLINEで質問しよう。"]
    ];
    $("#tutorial-body").innerHTML = steps.map(([title, text], i) => `
      <div class="tutorial-step"><span class="tutorial-no">${i + 1}</span><div><h3>${title}</h3><p>${text}</p></div></div>`).join("") +
      `<p class="tutorial-extra">書くタブのいちばん上の「フレーズを覚える！」で、おすすめフレーズ77を単語アプリと同じ4択テストとフラッシュカードで覚えられます。</p>`;
  }

  function renderPhraseList(query) {
    const q = String(query || "").trim().toLowerCase();
    const items = PHRASES.filter((p) => !q || p.en.toLowerCase().includes(q) || p.ja.includes(q));
    $("#phrase-list").innerHTML = items.map((p) => `<li value="${p.no}"><span class="phrase-en">${escapeHtml(p.en)}</span><span class="phrase-ja">${escapeHtml(p.ja)}</span></li>`).join("");
  }

  function renderPhraseHint(no) {
    const phrase = PHRASES.find((p) => p.no === Number(no));
    if (!phrase) return "";
    return `<p class="phrase-hint">使えそうなフレーズ：<b>${phrase.no}. ${escapeHtml(phrase.en)}</b>（${escapeHtml(phrase.ja)}）</p>`;
  }

  function renderGrammarChips(list) {
    if (!list || !list.length) return "";
    return `<p class="gchips">${list.map((item) => `<span class="gchip">${escapeHtml(item)}</span>`).join("")}</p>`;
  }

  function stepLabel(step) {
    return { ja: "日本語で書く", jaReview: "日本語の添削", en: "英語にする", result: "全文" }[step] || "";
  }

  // ===== 画面の共通処理 =====
  function showScreen(id) {
    $$(".screen").forEach((screen) => screen.classList.toggle("active", screen.id === id));
    const showTabs = !["screen-loading", "screen-welcome"].includes(id);
    $("#tab-bar").classList.toggle("hidden", !showTabs);
    const tabFor = {
      "screen-home": "screen-home", "screen-write": "screen-home",
      "screen-stats": "screen-stats", "screen-record": recordBack === "detail" ? "screen-admin" : "screen-stats",
      "screen-mypage": "screen-mypage", "screen-admin": "screen-admin",
      "screen-phrase-home": "screen-home", "screen-phrase-mode": "screen-home", "screen-phrase-quiz": "screen-home",
      "screen-phrase-fc": "screen-home", "screen-phrase-complete": "screen-home"
    }[id];
    $$(".tab-btn").forEach((button) => button.classList.toggle("active", button.dataset.tabScreen === tabFor));
    if (id !== "screen-record" && id !== "screen-write") document.body.classList.remove("memorize-mode");
  }

  function autoGrow(area) {
    area.style.height = "auto";
    area.style.height = `${area.scrollHeight + 4}px`;
  }

  function setBusy(on, text) {
    $("#busy-overlay").classList.toggle("hidden", !on);
    if (text) $("#busy-text").textContent = text;
  }

  function openModal(id) {
    $(`#${id}`).classList.remove("hidden");
  }

  function closeModal(id) {
    const element = $(`#${id}`);
    if (element) element.classList.add("hidden");
    if (id === "video-modal") $("#video-player").pause();
    if (id === "tutorial-modal") $("#tutorial-video").pause();
  }

  function showError(id, message) {
    const element = $(`#${id}`);
    if (!element) return;
    element.textContent = message;
    element.classList.remove("hidden");
  }

  function clearError(id) {
    const element = $(`#${id}`);
    if (!element) return;
    element.textContent = "";
    element.classList.add("hidden");
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.remove("hidden");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.add("hidden"), 2600);
  }

  function selectText(element) {
    if (!element) return;
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function dateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function formatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  // テスト用（tools/smoke-test.mjs から呼ぶ）
  window.__writingTest = { countWords, buildEssay, normalizeJaReview, normalizeEnReview, buildCopyText, mockJaReview, mockEnReview, calcStreak, calcBestStreak };
})();
