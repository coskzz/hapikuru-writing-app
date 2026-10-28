(() => {
  "use strict";

  const MODULE_ID = "writing";
  const LOCAL_USERS_KEY = "hapikuru.writing.localUsers.v1";
  const LOCAL_CURRENT_KEY = "hapikuru.writing.currentUser.v1";
  const LOCAL_DATA_PREFIX = "hapikuru.writing.data.v1.";
  const STEPS = ["ja", "jaReview", "en", "result"];
  const POINTS_PER_ESSAY = 10;

  const TOPICS = window.WRITING_TOPICS || [];
  const PHRASES = window.WRITING_PHRASES || [];
  const SCORING = window.WRITING_SCORING || [];
  const MODEL = window.WRITING_MODEL_ANSWER || null;
  const AI_URL = String(window.WRITING_AI_URL || "").replace(/\/$/, "");

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

  let currentUser = null;
  let currentProfile = null;
  let records = [];
  let moduleState = { tutorialDone: false };
  let editing = null;
  let recordBack = "screen-notes";
  let adminStudents = [];
  let adminStudentRecords = [];
  let toastTimer = null;

  document.addEventListener("DOMContentLoaded", init);

  // ===== 起動 =====
  async function init() {
    bindStaticEvents();
    renderTutorial();
    renderPhraseList("");
    initFirebase();

    if (firebaseReady) {
      auth.onAuthStateChanged(async (user) => {
        if (localMode) return;
        if (!user) {
          resetSession();
          showScreen("screen-welcome");
          return;
        }
        try {
          currentUser = user;
          await loadFirebaseData(user.uid);
          afterLogin();
        } catch (error) {
          console.error(error);
          showScreen("screen-welcome");
          showError("login-error", "データを読み込めませんでした。通信状態を確認して、もう一度ログインしてください。");
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

  function bindStaticEvents() {
    $("#show-signup").addEventListener("click", () => toggleAuthForm("signup"));
    $("#show-login").addEventListener("click", () => toggleAuthForm("login"));
    $("#btn-login").addEventListener("click", handleLogin);
    $("#btn-signup").addEventListener("click", handleSignup);
    $("#btn-demo-login").addEventListener("click", startDemo);
    $("#btn-logout").addEventListener("click", handleLogout);
    $("#btn-open-tutorial").addEventListener("click", () => openModal("tutorial-modal"));
    $("#btn-finish-tutorial").addEventListener("click", finishTutorial);
    $("#btn-resume").addEventListener("click", () => {
      const draft = latestDraft();
      if (draft) openEditor(draft);
    });
    $("#btn-write-back").addEventListener("click", leaveEditor);
    $("#btn-record-back").addEventListener("click", () => {
      showScreen(recordBack);
      if (recordBack === "screen-notes") renderNotes();
    });
    $("#btn-refresh-admin").addEventListener("click", loadAdminStudents);
    $("#admin-search").addEventListener("input", renderAdminList);
    $("#admin-show-all").addEventListener("change", renderAdminList);
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
      button.addEventListener("click", () => {
        const screen = button.dataset.tabScreen;
        if (!screen) return;
        showScreen(screen);
        if (screen === "screen-home") renderHome();
        if (screen === "screen-notes") renderNotes();
        if (screen === "screen-profile") renderProfile();
        if (screen === "screen-admin") loadAdminStudents();
      });
    });

    $$(".back-btn[data-back]").forEach((button) => {
      button.addEventListener("click", () => showScreen(button.dataset.back));
    });

    $$("[data-close-modal]").forEach((button) => {
      button.addEventListener("click", () => closeModal(button.dataset.closeModal));
    });

    document.addEventListener("click", (event) => {
      const opener = event.target.closest("[data-open-phrases]");
      if (opener) openModal("phrases-modal");
    });
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
    moduleState = { tutorialDone: false };
    editing = null;
  }

  async function loadFirebaseData(uid) {
    const profileSnap = await userDocRef(uid).get();
    const profile = profileSnap.exists ? profileSnap.data() : {};
    currentProfile = {
      uid,
      name: profile.name || "ハピクル生",
      userId: profile.userId || "",
      role: profile.role || "student"
    };
    const [moduleSnap, recordsSnap] = await Promise.all([
      moduleDocRef(uid).get(),
      recordsColRef(uid).get()
    ]);
    moduleState = moduleSnap.exists ? { tutorialDone: Boolean(moduleSnap.data().tutorialDone) } : { tutorialDone: false };
    records = recordsSnap.docs.map((doc) => normalizeRecord({ id: doc.id, ...doc.data() }));
    sortRecords(records);
  }

  function afterLogin() {
    $("#home-user-name").textContent = currentProfile?.name || "";
    $("#demo-badge").classList.toggle("hidden", !localMode);
    $("#tab-admin").classList.toggle("hidden", !isStaff());
    showScreen("screen-home");
    renderHome();
    if (!moduleState.tutorialDone) openModal("tutorial-modal");
  }

  // ===== デモ（この端末だけに保存・AIなし） =====
  function startDemo() {
    localMode = true;
    const users = getLocalUsers();
    users.local_demo = { uid: "local_demo", name: "デモユーザー", userId: "demo", password: "demo123", role: "teacher" };
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
    moduleState = data.moduleState || { tutorialDone: false };
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

  async function persistRecord(record) {
    record.updatedAt = new Date().toISOString();
    const index = records.findIndex((item) => item.id === record.id);
    if (index >= 0) records[index] = record;
    else records.unshift(record);
    sortRecords(records);

    if (localMode) {
      saveLocalData();
      return;
    }
    const uid = currentUser.uid;
    await recordsColRef(uid).doc(record.id).set(toFirestore(record));
    await moduleDocRef(uid).set({
      moduleId: MODULE_ID,
      essayCount: records.filter((item) => item.status === "done").length,
      essayDraftCount: records.filter((item) => item.status !== "done").length,
      summaryCount: 0,
      lastActivityAt: record.updatedAt,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  }

  async function removeRecord(record) {
    records = records.filter((item) => item.id !== record.id);
    if (localMode) {
      saveLocalData();
      return;
    }
    const uid = currentUser.uid;
    await recordsColRef(uid).doc(record.id).delete();
    await moduleDocRef(uid).set({
      essayCount: records.filter((item) => item.status === "done").length,
      essayDraftCount: records.filter((item) => item.status !== "done").length,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  }

  async function recordActivity() {
    if (localMode) return;
    const uid = currentUser.uid;
    const date = todayKey();
    const FieldValue = firebase.firestore.FieldValue;
    await Promise.all([
      userDocRef(uid).collection("streaks").doc(date).set({
        date, modules: FieldValue.arrayUnion(MODULE_ID), updatedAt: FieldValue.serverTimestamp()
      }, { merge: true }),
      userDocRef(uid).collection("points").doc("summary").set({
        total: FieldValue.increment(POINTS_PER_ESSAY), updatedAt: FieldValue.serverTimestamp()
      }, { merge: true })
    ]).catch((error) => console.warn("activity not saved", error));
  }

  async function finishTutorial() {
    closeModal("tutorial-modal");
    if (moduleState.tutorialDone) return;
    moduleState.tutorialDone = true;
    if (localMode) {
      saveLocalData();
      return;
    }
    await moduleDocRef(currentUser.uid).set({ moduleId: MODULE_ID, tutorialDone: true }, { merge: true }).catch(() => {});
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
    return TOPICS.find((topic) => topic.id === id) || null;
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
    $("#topic-list").innerHTML = shown.length ? shown.map((topic) => {
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
    }).join("") : `<p class="empty-panel">見つかりませんでした。</p>`;

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
    if (target === "screen-notes") renderNotes();
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
      setBusy(true, "AIが日本語を添削しています");
      const result = await callAI("/api/review-ja", body);
      editing.jaReview = normalizeJaReview(result, editing);
      editing.step = "jaReview";
      await persistRecord(editing).catch((error) => console.warn(error));
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
      setBusy(true, "AIが英文を添削して、全文を組み立てています");
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
      if (firstFinish) await recordActivity();
      showToast("ノートに保存しました");
    } catch (error) {
      console.error(error);
      showToast("ノートに保存できませんでした。通信を確認してから「ノートを見る」を押してください");
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
    if (localMode) {
      await new Promise((resolve) => window.setTimeout(resolve, 900));
      return path === "/api/review-ja" ? mockJaReview(body) : mockEnReview(body);
    }
    if (!AI_URL) throw new Error("AIの設定がまだありません。田中先生に知らせてください。");
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
          "1つ目：Nowadays, ＋トピックの名詞＋has been a controversial issue in Japan. 名詞のかたまりを入れ替えればほかのトピックでも使える。",
          "2つ目：Although some argue that we don't have to change 〜（don't have to＋動詞の原形）。3つ目をただ否定にした形にしないのがポイント。",
          "3つ目：I strongly believe that high school education should be improved（助動詞＋受動態）for the following two reasons."
        ]
      } : { text: "(Demo) Nowadays, ... has been a controversial issue in Japan. Although some argue that ..., I strongly believe that ... for the following two reasons.", ja: demoNote, notes: [demoNote] },
      paragraph4: useModel ? {
        text: MODEL.paragraphs[3],
        ja: MODEL.paragraphsJa[3],
        nouns: ["the necessity of changing curriculum", "adaptation to globalization"],
        notes: [
          "理由1「カリキュラムが生徒の力を伸ばすのに効果的でない」→ the necessity of changing curriculum（動名詞 changing を使った名詞のかたまり）",
          "理由2「グローバル社会で英語を話す力を伸ばす必要がある」→ adaptation to globalization（adapt を名詞 adaptation に語形変化）",
          "結論：there is no doubt that we should improve 〜（能動態）。1段落目の3つ目（助動詞＋受動態）と形を変えている。"
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
        <h2>わからない所は田中先生にLINEで質問</h2>
        <p class="hint">なぜこの形になるのか分からない所（関係代名詞・受動態など）は、下をそのままコピーしてLINEで送ろう。最後の「質問」に聞きたいことを書いてね。</p>
        <pre class="copy-block" id="copy-block">${escapeHtml(buildCopyText(record, options && options.ownerName))}</pre>
        <div class="button-row">
          <button class="btn btn-primary" data-copy>コピーする</button>
          <a class="btn btn-secondary" data-line-share target="_blank" rel="noopener">LINEで送る</a>
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
        <button class="btn btn-secondary" data-go-notes>ノートを見る</button>
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
    if (share && $("#copy-block")) share.href = `https://line.me/R/share?text=${encodeURIComponent($("#copy-block").textContent)}`;
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
    if (goNotes) goNotes.addEventListener("click", () => closeEditor("screen-notes"));
    const goHome = document.querySelector("[data-go-home]");
    if (goHome) goHome.addEventListener("click", () => closeEditor("screen-home"));
  }

  // ===== ノート =====
  function renderNotes() {
    const done = records.filter((record) => record.status === "done");
    const drafts = records.filter((record) => record.status !== "done");
    $("#notes-stats").innerHTML = statsHtml(done, drafts);
    $("#notes-list").innerHTML = records.length
      ? records.map((record) => recordRowHtml(record)).join("")
      : `<p class="empty-panel">まだありません。「書く」からトピックを選んで始めよう。</p>`;
    $$("#notes-list [data-record]").forEach((row) => {
      row.addEventListener("click", () => {
        const record = records.find((item) => item.id === row.dataset.record);
        if (!record) return;
        if (record.status !== "done") openEditor(record);
        else openRecordView(record, { back: "screen-notes", own: true });
      });
    });
  }

  function statsHtml(done, drafts) {
    const words = done.map((record) => record.essay?.wordCount || 0).filter(Boolean);
    const average = words.length ? Math.round(words.reduce((a, b) => a + b, 0) / words.length) : 0;
    return `
      <div class="metric-card"><span class="metric-value">${done.length}</span><span class="metric-label">英作文 完了</span></div>
      <div class="metric-card"><span class="metric-value">${drafts.length}</span><span class="metric-label">書きかけ</span></div>
      <div class="metric-card"><span class="metric-value">${average || "-"}</span><span class="metric-label">平均語数</span></div>
      <div class="metric-card muted"><span class="metric-value">0</span><span class="metric-label">要約（準備中）</span></div>`;
  }

  function recordRowHtml(record) {
    const state = record.status === "done"
      ? `<span class="badge badge-done">完了 ${record.essay?.wordCount || 0}語</span>`
      : `<span class="badge badge-draft">書きかけ・${stepLabel(record.step)}</span>`;
    return `
      <button class="record-row" data-record="${escapeAttr(record.id)}">
        <span class="record-date">${formatDate(record.completedAt || record.updatedAt || record.createdAt)}</span>
        <span class="record-topic">${escapeHtml(record.topic.en)}</span>
        <span class="record-meta">${escapeHtml(record.topic.label || "")} ${state}</span>
      </button>`;
  }

  function openRecordView(record, options) {
    recordBack = options.back;
    $("#record-label").textContent = `${record.topic.label || ""}　${formatDate(record.completedAt || record.updatedAt)}`;
    $("#record-topic-en").textContent = record.topic.en;
    $("#record-topic-ja").textContent = record.topic.ja || "";
    $("#record-body").innerHTML = renderResult(record, { own: false, ownerName: options.ownerName });
    document.body.classList.remove("memorize-mode");
    showScreen("screen-record");
    bindResultEvents(record);
    window.scrollTo({ top: 0 });
  }

  // ===== プロフィール =====
  function renderProfile() {
    const done = records.filter((record) => record.status === "done").length;
    $("#profile-body").innerHTML = `
      <dl class="profile-list">
        <dt>名前</dt><dd>${escapeHtml(currentProfile?.name || "")}</dd>
        <dt>ID</dt><dd>${escapeHtml(currentProfile?.userId || "")}</dd>
        <dt>英作文 完了</dt><dd>${done}題</dd>
        <dt>モード</dt><dd>${localMode ? "デモ（この端末だけに保存・AIなし）" : "ログイン中（AI添削あり）"}</dd>
      </dl>
      <button class="text-btn" id="btn-profile-tutorial">使い方をもう一度見る</button>`;
    $("#btn-profile-tutorial").addEventListener("click", () => openModal("tutorial-modal"));
  }

  // ===== 管理画面（講師） =====
  function isStaff() {
    return ["teacher", "admin"].includes(currentProfile?.role);
  }

  async function loadAdminStudents() {
    if (!isStaff()) return;
    $("#admin-student-list").innerHTML = `<p class="hint">読み込み中…</p>`;
    try {
      if (localMode) {
        adminStudents = Object.values(getLocalUsers()).map((user) => {
          const list = (readLocalData(user.uid).records || []);
          return {
            uid: user.uid, name: user.name, userId: user.userId,
            essayCount: list.filter((record) => record.status === "done").length,
            essayDraftCount: list.filter((record) => record.status !== "done").length,
            lastActivityAt: list[0]?.updatedAt || ""
          };
        });
      } else {
        const snapshot = await db.collection("users").where("role", "==", "student").get();
        const students = snapshot.docs.map((doc) => ({ uid: doc.id, ...doc.data() }));
        const modules = await Promise.all(students.map((student) => moduleDocRef(student.uid).get().catch(() => null)));
        adminStudents = students.map((student, i) => {
          const data = modules[i] && modules[i].exists ? modules[i].data() : {};
          return {
            uid: student.uid,
            name: student.name || "",
            userId: student.userId || "",
            archived: student.archived === true,
            essayCount: Number(data.essayCount || 0),
            essayDraftCount: Number(data.essayDraftCount || 0),
            lastActivityAt: data.lastActivityAt || ""
          };
        });
      }
      renderAdminList();
    } catch (error) {
      console.error(error);
      $("#admin-student-list").innerHTML = `<p class="form-error">読み込めませんでした（${escapeHtml(error.code || error.message)}）。</p>`;
    }
  }

  function renderAdminList() {
    const query = $("#admin-search").value.trim().toLowerCase();
    const showAll = $("#admin-show-all").checked;
    const rows = adminStudents
      .filter((student) => !student.archived)
      .filter((student) => showAll || student.essayCount + student.essayDraftCount > 0)
      .filter((student) => !query || `${student.name} ${student.userId}`.toLowerCase().includes(query))
      .sort((a, b) => String(b.lastActivityAt).localeCompare(String(a.lastActivityAt)) || a.name.localeCompare(b.name, "ja"));
    $("#admin-student-list").innerHTML = rows.length ? `
      <div class="admin-row admin-row-head"><span>名前</span><span>英作文</span><span>書きかけ</span><span>要約</span><span>最後</span></div>
      ${rows.map((student) => `
        <button class="admin-row" data-student="${escapeAttr(student.uid)}">
          <span><b>${escapeHtml(student.name)}</b><small>${escapeHtml(student.userId)}</small></span>
          <span>${student.essayCount}題</span>
          <span>${student.essayDraftCount}</span>
          <span>0</span>
          <span>${student.lastActivityAt ? formatDate(student.lastActivityAt) : "-"}</span>
        </button>`).join("")}` : `<p class="empty-panel">${showAll ? "生徒がいません。" : "まだ取り組んだ生徒がいません。「取り組みゼロの生徒も出す」で全員を表示できます。"}</p>`;
    $$("[data-student]").forEach((row) => row.addEventListener("click", () => openAdminStudent(row.dataset.student)));
  }

  async function openAdminStudent(uid) {
    const student = adminStudents.find((item) => item.uid === uid);
    if (!student) return;
    $("#admin-student-name").textContent = student.name;
    $("#admin-student-id").textContent = `ID：${student.userId}`;
    $("#admin-student-records").innerHTML = `<p class="hint">読み込み中…</p>`;
    $("#admin-student-stats").innerHTML = "";
    showScreen("screen-admin-student");
    try {
      if (localMode) {
        adminStudentRecords = (readLocalData(uid).records || []).map(normalizeRecord);
      } else {
        const snapshot = await recordsColRef(uid).get();
        adminStudentRecords = snapshot.docs.map((doc) => normalizeRecord({ id: doc.id, ...doc.data() }));
      }
      sortRecords(adminStudentRecords);
      const done = adminStudentRecords.filter((record) => record.status === "done");
      const drafts = adminStudentRecords.filter((record) => record.status !== "done");
      $("#admin-student-stats").innerHTML = statsHtml(done, drafts);
      $("#admin-student-records").innerHTML = adminStudentRecords.length
        ? adminStudentRecords.map(recordRowHtml).join("")
        : `<p class="empty-panel">まだ記録がありません。</p>`;
      $$("#admin-student-records [data-record]").forEach((row) => {
        row.addEventListener("click", () => {
          const record = adminStudentRecords.find((item) => item.id === row.dataset.record);
          if (record) openRecordView(record, { back: "screen-admin-student", ownerName: student.name });
        });
      });
    } catch (error) {
      console.error(error);
      $("#admin-student-records").innerHTML = `<p class="form-error">読み込めませんでした（${escapeHtml(error.code || error.message)}）。</p>`;
    }
  }

  // ===== 使い方・フレーズ =====
  function renderTutorial() {
    const steps = [
      ["トピックを選ぶ", "英検準1級の過去問から選びます。"],
      ["理由を日本語で6文", "賛成か反対かを決めて、理由を2つ。理由ごとにPOINTを1つ選び、3文ずつ書きます（理由→具体例→まとめ）。"],
      ["AIが日本語を整える", "中学で習う文法で英語にできる日本語に直します。どの文法で書くかを見越した理由もコメントで返ってきます。"],
      ["英語にする", "直った日本語を見ながら、6文を英語にして送信します。"],
      ["全文が出る", "1段落目と4段落目はアプリが型どおりに作ります。全文はノートにたまるので、覚えて授業へ。分からない所はコピーして田中先生にLINEで質問しよう。"]
    ];
    $("#tutorial-body").innerHTML = steps.map(([title, text], i) => `
      <div class="tutorial-step"><span class="tutorial-no">${i + 1}</span><div><h3>${title}</h3><p>${text}</p></div></div>`).join("");
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
    return `<p class="chips">${list.map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join("")}</p>`;
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
      "screen-notes": "screen-notes", "screen-record": recordBack === "screen-notes" ? "screen-notes" : "screen-admin",
      "screen-profile": "screen-profile", "screen-admin": "screen-admin", "screen-admin-student": "screen-admin"
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
    $(`#${id}`).classList.add("hidden");
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

  function todayKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
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
  window.__writingTest = { countWords, buildEssay, normalizeJaReview, normalizeEnReview, buildCopyText, mockJaReview, mockEnReview };
})();
