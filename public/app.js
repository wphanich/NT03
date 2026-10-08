import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  getAuth, connectAuthEmulator, onAuthStateChanged,
  signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  getFirestore, connectFirestoreEmulator, collection, doc, getDoc, onSnapshot,
  addDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, deleteField,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

{
  const TEAMS = ["นต031", "นต032", "นต033", "นต034", "นต035", "นต036", "นต037"];
  const OTHER_TYPE = "ตรวจอื่นๆ"; // เลือกแล้วต้องพิมพ์ระบุเพิ่มในช่อง inspectionOther
  const DEFAULT_TYPES = [
    "ตรวจคืนภาษีมูลค่าเพิ่ม (ภ.พ.30)",
    "ตรวจคืนภาษีเงินได้นิติบุคคล",
    "ตรวจคืนภาษีเงินได้บุคคลธรรมดา",
    "ตรวจวิเคราะห์ฯ",
    "ตรวจปฏิบัติการ",
    "ตรวจแนะนำ",
    OTHER_TYPE,
  ];
  const THAI_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
                       "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

  const $ = (id) => document.getElementById(id);
  const form = $("jobForm");
  const ADDR_FIELDS = ["addrNo", "addrBuilding", "addrFloor", "addrSoi", "addrRoad",
                       "addrSubdistrict", "addrDistrict", "addrProvince", "addrPostcode"];
  const ADDR_REQUIRED = ["addrNo", "addrSubdistrict", "addrDistrict", "addrProvince"];
  const fields = ["receivedDate", "inspectionType", "inspectionOther", "taxId", "name"]
    .concat(ADDR_FIELDS, ["refundAmount", "team", "note"]);
  const BANGKOK = "กรุงเทพมหานคร";
  // จังหวัด > เขต/อำเภอ > แขวง/ตำบล > รหัสไปรษณีย์ (ข้อมูลจาก thai-address.js)
  const GEO = new Map();
  (window.THAI_ADDRESS || []).forEach(([prov, districts]) => {
    const dm = new Map();
    districts.forEach(([dist, subs]) => dm.set(dist, new Map(subs.map(([sub, zip]) => [sub, String(zip)]))));
    GEO.set(prov, dm);
  });
  const thSort = (arr) => arr.sort((a, b) => a.localeCompare(b, "th"));

  // รวมที่อยู่เป็นข้อความเดียว (กทม. ใช้ แขวง/เขต จังหวัดอื่นใช้ ตำบล/อำเภอ)
  function fullAddress(j) {
    if (!j.addrNo && !j.addrProvince) return j.address || ""; // ข้อมูลรูปแบบเดิม
    const bkk = j.addrProvince === BANGKOK;
    const parts = [
      j.addrNo && "เลขที่ " + j.addrNo,
      j.addrBuilding && "อาคาร" + j.addrBuilding,
      j.addrFloor && "ชั้น " + j.addrFloor,
      j.addrSoi && "ซอย" + j.addrSoi,
      j.addrRoad && "ถนน" + j.addrRoad,
      j.addrSubdistrict && (bkk ? "แขวง" : "ตำบล") + j.addrSubdistrict,
      j.addrDistrict && (bkk ? "เขต" : "อำเภอ") + j.addrDistrict,
      j.addrProvince && (bkk ? j.addrProvince : "จังหวัด" + j.addrProvince),
      j.addrPostcode,
    ];
    return parts.filter(Boolean).join(" ");
  }

  let jobs = [];
  let editingId = null;
  let sortKey = "receivedDate";
  let sortDir = -1; // ใหม่สุดก่อน
  let currentUser = null;
  let unsubscribeJobs = null;

  // ---------- Firebase ----------
  const configured = firebaseConfig && firebaseConfig.apiKey && !/^YOUR_/.test(firebaseConfig.apiKey);
  let auth = null;
  let db = null;
  if (configured) {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    // ทดสอบในเครื่องด้วย Firebase Emulator: เปิด http://localhost:5000/?emulator
    if (["localhost", "127.0.0.1"].includes(location.hostname) &&
        new URLSearchParams(location.search).has("emulator")) {
      connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
      connectFirestoreEmulator(db, "127.0.0.1", 8080);
    }
  }
  const jobsCol = () => collection(db, "jobs");

  function showScreen(name) {
    ["setupScreen", "loginScreen", "noAccessScreen", "appScreen"].forEach((id) => {
      $(id).hidden = id !== name;
    });
    $("userBox").hidden = name === "setupScreen" || name === "loginScreen";
  }

  function stopListening() {
    if (unsubscribeJobs) unsubscribeJobs();
    unsubscribeJobs = null;
    jobs = [];
  }

  function startListening() {
    stopListening();
    $("syncStatus").textContent = "กำลังโหลดข้อมูล...";
    unsubscribeJobs = onSnapshot(jobsCol(), { includeMetadataChanges: true }, (snap) => {
      jobs = snap.docs.map((d) => {
        const data = d.data({ serverTimestamps: "estimate" });
        return Object.assign({}, data, {
          id: d.id,
          createdAt: data.createdAt && data.createdAt.toMillis ? data.createdAt.toMillis() : 0,
          updatedAt: data.updatedAt && data.updatedAt.toMillis ? data.updatedAt.toMillis() : 0,
        });
      });
      $("syncStatus").textContent = snap.metadata.hasPendingWrites
        ? "กำลังบันทึก..."
        : "ข้อมูลล่าสุด " + new Date().toLocaleTimeString("th-TH");
      render();
    }, (err) => {
      $("syncStatus").textContent = "โหลดข้อมูลไม่สำเร็จ";
      alert("ไม่สามารถโหลดข้อมูลได้: " + err.message);
    });
  }

  if (!configured) {
    showScreen("setupScreen");
  } else {
    onAuthStateChanged(auth, async (user) => {
      currentUser = user;
      stopListening();
      if (!user) { showScreen("loginScreen"); return; }
      $("userEmail").textContent = user.email || user.uid;
      // ต้องมีเอกสาร members/{uid} จึงจะใช้งานได้ (ผู้ดูแลเพิ่มใน Firebase Console)
      let member = false;
      try { member = (await getDoc(doc(db, "members", user.uid))).exists(); } catch (e) { member = false; }
      if (!member) {
        $("noAccessUid").textContent = user.uid;
        $("noAccessEmail").textContent = user.email || "";
        showScreen("noAccessScreen");
        return;
      }
      showScreen("appScreen");
      resetForm();
      startListening();
    });
  }

  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("loginBtn");
    $("loginError").textContent = "";
    btn.disabled = true;
    try {
      await signInWithEmailAndPassword(auth, $("loginEmail").value.trim(), $("loginPassword").value);
      $("loginPassword").value = "";
    } catch (err) {
      $("loginError").textContent = ["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found",
                                     "auth/invalid-email"].includes(err.code)
        ? "อีเมลหรือรหัสผ่านไม่ถูกต้อง"
        : err.code === "auth/too-many-requests"
          ? "เข้าสู่ระบบผิดหลายครั้ง กรุณารอสักครู่แล้วลองใหม่"
          : "เข้าสู่ระบบไม่สำเร็จ: " + err.message;
    } finally {
      btn.disabled = false;
    }
  });

  $("forgotBtn").addEventListener("click", async () => {
    const email = $("loginEmail").value.trim();
    if (!email) { $("loginError").textContent = "กรุณากรอกอีเมลก่อน แล้วกด \"ลืมรหัสผ่าน\" อีกครั้ง"; return; }
    try {
      await sendPasswordResetEmail(auth, email);
      $("loginError").textContent = "";
      toast("ส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่ " + email + " แล้ว");
    } catch (err) {
      $("loginError").textContent = "ส่งอีเมลไม่สำเร็จ: " + err.message;
    }
  });

  [$("logoutBtn"), $("noAccessLogoutBtn")].forEach((b) =>
    b.addEventListener("click", () => signOut(auth)));

  // ---------- helpers ----------
  function todayISO() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }
  function thaiDate(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-").map(Number);
    return d + " " + THAI_MONTHS[m - 1] + " " + (y + 543);
  }
  function digitsOnly(s) { return String(s || "").replace(/\D/g, ""); }
  function formatTaxId(s) {
    const d = digitsOnly(s);
    if (d.length !== 13) return s || "";
    return d[0] + "-" + d.slice(1, 5) + "-" + d.slice(5, 10) + "-" + d.slice(10, 12) + "-" + d[12];
  }
  // ตรวจสอบหลักตรวจสอบ (check digit) ของเลข 13 หลัก
  function validTaxIdChecksum(d) {
    if (!/^\d{13}$/.test(d)) return false;
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(d[i]) * (13 - i);
    return (11 - (sum % 11)) % 10 === Number(d[12]);
  }
  function parseAmount(s) {
    const t = String(s || "").replace(/[,\s]/g, "");
    if (t === "") return 0;
    if (!/^\d+(\.\d{0,2})?$/.test(t)) return NaN;
    return Math.round(Number(t) * 100) / 100;
  }
  function money(n) {
    return Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("show"), 2200);
  }
  function setHint(id, msg, cls) {
    const el = $(id + "Hint") || $(id).parentElement.querySelector(".hint");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "hint" + (cls ? " " + cls : "");
  }
  function uniqueValues(key, defaults) {
    const set = new Set(defaults || []);
    jobs.forEach((j) => j[key] && set.add(j[key]));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "th"));
  }

  // ---------- ที่อยู่: เลือกจังหวัด > เขต/อำเภอ > แขวง/ตำบล ----------
  // หากโหลด thai-address.js ไม่ได้ ให้กลับไปใช้ช่องพิมพ์ข้อความแทน
  if (!GEO.size) {
    ["addrProvince", "addrDistrict", "addrSubdistrict"].forEach((id) => {
      const input = document.createElement("input");
      input.type = "text";
      input.id = id;
      input.required = true;
      $(id).replaceWith(input);
    });
  }

  function fillOptions(sel, values, placeholder, keep) {
    const opts = ['<option value="">' + placeholder + "</option>"]
      .concat(values.map((v) => '<option value="' + esc(v) + '">' + esc(v) + "</option>"));
    // ค่าที่บันทึกไว้แต่ไม่อยู่ในรายการ (เช่น ข้อมูลเก่า) ยังคงเลือกไว้ได้
    if (keep && !values.includes(keep)) {
      opts.push('<option value="' + esc(keep) + '">' + esc(keep) + " (ไม่อยู่ในรายการ)</option>");
    }
    sel.innerHTML = opts.join("");
    sel.value = keep || "";
    sel.disabled = opts.length === 1;
  }

  function updateAddrLabels(prov) {
    const bkk = prov === BANGKOK;
    $("addrDistrictLabel").textContent = !prov ? "เขต/อำเภอ" : bkk ? "เขต" : "อำเภอ";
    $("addrSubdistrictLabel").textContent = !prov ? "แขวง/ตำบล" : bkk ? "แขวง" : "ตำบล";
  }

  function setAddress(prov, dist, sub) {
    updateAddrLabels(prov);
    if (!GEO.size) {
      $("addrProvince").value = prov || "";
      $("addrDistrict").value = dist || "";
      $("addrSubdistrict").value = sub || "";
      return;
    }
    const dm = GEO.get(prov);
    const sm = dm && dm.get(dist);
    const bkk = prov === BANGKOK;
    fillOptions($("addrProvince"), thSort(Array.from(GEO.keys())), "-- เลือกจังหวัด --", prov);
    fillOptions($("addrDistrict"), dm ? thSort(Array.from(dm.keys())) : [],
                bkk ? "-- เลือกเขต --" : "-- เลือกอำเภอ --", dist);
    fillOptions($("addrSubdistrict"), sm ? thSort(Array.from(sm.keys())) : [],
                bkk ? "-- เลือกแขวง --" : "-- เลือกตำบล --", sub);
  }

  function zipOf(prov, dist, sub) {
    const dm = GEO.get(prov);
    const sm = dm && dm.get(dist);
    return (sm && sm.get(sub)) || "";
  }

  if (GEO.size) {
    $("addrProvince").addEventListener("change", () => {
      setAddress($("addrProvince").value, "", "");
      $("addrPostcode").value = "";
    });
    $("addrDistrict").addEventListener("change", () => {
      setAddress($("addrProvince").value, $("addrDistrict").value, "");
      $("addrPostcode").value = "";
    });
    $("addrSubdistrict").addEventListener("change", () => {
      $("addrPostcode").value = zipOf($("addrProvince").value, $("addrDistrict").value,
                                      $("addrSubdistrict").value);
    });
  }

  // ---------- ประเภทการตรวจ ----------
  function typeLabel(j) {
    return j.inspectionType === OTHER_TYPE && j.inspectionOther
      ? OTHER_TYPE + " (" + j.inspectionOther + ")"
      : j.inspectionType || "";
  }

  // ค่าเดิมที่ไม่อยู่ในรายการ (เช่น ข้อมูลที่บันทึกก่อนเปลี่ยนรายการ) ยังแสดงและเลือกไว้ได้
  function setInspectionType(type, other) {
    fillOptions($("inspectionType"), DEFAULT_TYPES, "-- เลือกประเภทการตรวจ --", type);
    $("inspectionOther").value = other || "";
    toggleInspectionOther();
  }
  function toggleInspectionOther() {
    const show = $("inspectionType").value === OTHER_TYPE;
    $("inspectionOther").hidden = !show;
    if (!show) setHint("inspectionOther", "");
  }
  $("inspectionType").addEventListener("change", () => {
    toggleInspectionOther();
    if (!$("inspectionOther").hidden) $("inspectionOther").focus();
  });

  // ---------- form ----------
  function resetForm() {
    form.reset();
    editingId = null;
    $("receivedDate").value = todayISO();
    fillOptions($("team"), TEAMS, "-- เลือกทีม --", "");
    setAddress("", "", "");
    setInspectionType("", "");
    $("formTitle").textContent = "บันทึกรับงานใหม่";
    $("editingBanner").style.display = "none";
    $("cancelEditBtn").style.display = "none";
    $("saveBtn").textContent = "บันทึก";
    form.querySelectorAll(".hint").forEach((h) => { h.textContent = ""; h.className = "hint"; });
    $("taxIdHint").textContent = "ตัวเลข 13 หลัก";
    updateDateHint();
  }

  function updateDateHint() {
    const v = $("receivedDate").value;
    setHint("receivedDate", v ? thaiDate(v) : "", "");
  }

  function validate() {
    let ok = true;
    const data = {};
    fields.forEach((f) => { data[f] = $(f).value.trim(); });

    ["receivedDate", "inspectionType", "name", "team"].concat(ADDR_REQUIRED).forEach((f) => {
      if (!data[f]) { setHint(f, "กรุณากรอกข้อมูล", "err"); ok = false; }
      else if (f !== "receivedDate") setHint(f, "");
    });

    if (data.inspectionType === OTHER_TYPE && !data.inspectionOther) {
      setHint("inspectionOther", "กรุณาระบุประเภทการตรวจ", "err");
      ok = false;
    } else {
      setHint("inspectionOther", "");
    }
    if (data.inspectionType !== OTHER_TYPE) data.inspectionOther = "";

    if (data.addrPostcode && !/^\d{5}$/.test(data.addrPostcode)) {
      setHint("addrPostcode", "รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก", "err");
      ok = false;
    } else {
      setHint("addrPostcode", "");
    }
    if (data.receivedDate) updateDateHint();

    const tax = digitsOnly(data.taxId);
    if (tax.length !== 13) {
      setHint("taxId", "ต้องเป็นตัวเลข 13 หลัก (กรอกแล้ว " + tax.length + " หลัก)", "err");
      ok = false;
    }
    data.taxId = tax;

    const amt = parseAmount(data.refundAmount);
    if (isNaN(amt) || amt < 0) {
      setHint("refundAmount", "จำนวนเงินไม่ถูกต้อง (ทศนิยมไม่เกิน 2 ตำแหน่ง)", "err");
      ok = false;
    } else {
      setHint("refundAmount", "");
    }
    data.refundAmount = amt;

    return ok ? data : null;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = validate();
    if (!data) { toast("กรุณาตรวจสอบข้อมูลที่ไม่ถูกต้อง"); return; }

    if (!validTaxIdChecksum(data.taxId) &&
        !confirm("เลขประจำตัวผู้เสียภาษี " + formatTaxId(data.taxId) +
                 " ไม่ผ่านการตรวจสอบหลักสุดท้าย\nต้องการบันทึกต่อหรือไม่?")) {
      return;
    }

    const dup = jobs.find((j) => j.id !== editingId && j.taxId === data.taxId &&
                                 typeLabel(j) === typeLabel(data));
    if (dup && !confirm("มีงานของเลขผู้เสียภาษีนี้ ประเภท \"" + typeLabel(data) +
                        "\" แล้ว (รับเมื่อ " + thaiDate(dup.receivedDate) + ")\nต้องการบันทึกซ้ำหรือไม่?")) {
      return;
    }

    const btn = $("saveBtn");
    btn.disabled = true;
    try {
      const who = currentUser.email || currentUser.uid;
      if (editingId) {
        await updateDoc(doc(db, "jobs", editingId), Object.assign({}, data, {
          address: deleteField(), // ที่อยู่รูปแบบเดิม ถูกแทนด้วยช่องที่แยกแล้ว
          updatedAt: serverTimestamp(),
          updatedBy: who,
        }));
        toast("แก้ไขข้อมูลเรียบร้อย");
      } else {
        await addDoc(jobsCol(), Object.assign({}, data, {
          createdAt: serverTimestamp(),
          createdBy: who,
        }));
        toast("บันทึกงานใหม่เรียบร้อย");
      }
      resetForm();
    } catch (err) {
      alert("บันทึกไม่สำเร็จ: " + err.message);
    } finally {
      btn.disabled = false;
    }
  });

  $("resetBtn").addEventListener("click", resetForm);
  $("cancelEditBtn").addEventListener("click", resetForm);
  $("receivedDate").addEventListener("change", updateDateHint);

  $("taxId").addEventListener("input", () => {
    const d = digitsOnly($("taxId").value).slice(0, 13);
    if (d.length < 13) {
      setHint("taxId", "ตัวเลข 13 หลัก (กรอกแล้ว " + d.length + " หลัก)", "");
    } else if (validTaxIdChecksum(d)) {
      setHint("taxId", "รูปแบบเลขถูกต้อง", "ok");
    } else {
      setHint("taxId", "หลักตรวจสอบไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง", "err");
    }
  });
  $("taxId").addEventListener("blur", () => { $("taxId").value = formatTaxId($("taxId").value); });

  $("refundAmount").addEventListener("blur", () => {
    const v = parseAmount($("refundAmount").value);
    if ($("refundAmount").value.trim() !== "" && !isNaN(v)) $("refundAmount").value = money(v);
  });
  $("refundAmount").addEventListener("focus", () => {
    $("refundAmount").value = $("refundAmount").value.replace(/,/g, "");
  });

  function startEdit(id) {
    const j = jobs.find((x) => x.id === id);
    if (!j) return;
    editingId = id;
    fields.forEach((f) => { $(f).value = j[f] == null ? "" : j[f]; });
    setAddress(j.addrProvince, j.addrDistrict, j.addrSubdistrict);
    setInspectionType(j.inspectionType, j.inspectionOther);
    fillOptions($("team"), TEAMS, "-- เลือกทีม --", j.team);
    $("taxId").value = formatTaxId(j.taxId);
    $("refundAmount").value = j.refundAmount ? money(j.refundAmount) : "";
    $("formTitle").textContent = "แก้ไขข้อมูลงาน";
    $("editingBanner").style.display = "block";
    $("cancelEditBtn").style.display = "inline-block";
    $("saveBtn").textContent = "บันทึกการแก้ไข";
    updateDateHint();
    if (j.address && !j.addrNo) {
      setHint("addrNo", "ที่อยู่เดิม: " + j.address + " — กรุณากรอกแยกช่อง", "err");
    }
    $("formCard").scrollIntoView({ behavior: "smooth" });
  }

  async function remove(id) {
    const j = jobs.find((x) => x.id === id);
    if (!j) return;
    if (!confirm("ต้องการลบงานของ \"" + j.name + "\" ใช่หรือไม่?")) return;
    try {
      await deleteDoc(doc(db, "jobs", id));
      if (editingId === id) resetForm();
      toast("ลบรายการแล้ว");
    } catch (err) {
      alert("ลบไม่สำเร็จ: " + err.message);
    }
  }

  // ---------- list ----------
  function auditText(j) {
    const t = (ms) => (ms ? new Date(ms).toLocaleString("th-TH") : "");
    let s = "บันทึกโดย " + (j.createdBy || "-") + " " + t(j.createdAt);
    if (j.updatedBy) s += "\nแก้ไขล่าสุดโดย " + j.updatedBy + " " + t(j.updatedAt);
    return s;
  }
  function fillSelect(sel, values, allLabel) {
    const cur = sel.value;
    sel.innerHTML = '<option value="">' + allLabel + "</option>" +
      values.map((v) => '<option value="' + esc(v) + '">' + esc(v) + "</option>").join("");
    sel.value = values.includes(cur) ? cur : "";
  }

  function filtered() {
    const q = $("fSearch").value.trim().toLowerCase();
    const qDigits = digitsOnly(q);
    const type = $("fType").value;
    const team = $("fTeam").value;
    const from = $("fFrom").value;
    const to = $("fTo").value;
    return jobs.filter((j) => {
      if (type && j.inspectionType !== type) return false;
      if (team && j.team !== team) return false;
      if (from && j.receivedDate < from) return false;
      if (to && j.receivedDate > to) return false;
      if (q) {
        const hay = [j.name, fullAddress(j), j.note, typeLabel(j), j.team].join(" ").toLowerCase();
        const hit = hay.includes(q) || (qDigits && j.taxId.includes(qDigits));
        if (!hit) return false;
      }
      return true;
    }).sort((a, b) => {
      const x = a[sortKey], y = b[sortKey];
      let c = typeof x === "number" ? x - y : String(x || "").localeCompare(String(y || ""), "th");
      if (c === 0) c = (a.createdAt || 0) - (b.createdAt || 0);
      return c * sortDir;
    });
  }

  function render() {
    fillSelect($("fType"), uniqueValues("inspectionType"), "ทุกประเภทการตรวจ");
    fillSelect($("fTeam"), uniqueValues("team", TEAMS), "ทุกทีม");

    const rows = filtered();
    const tbody = $("tbody");
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="10" class="empty">' +
        (jobs.length ? "ไม่พบรายการตามเงื่อนไขที่ค้นหา" : "ยังไม่มีข้อมูลงาน") + "</td></tr>";
    } else {
      tbody.innerHTML = rows.map((j, i) =>
        "<tr>" +
        "<td>" + (i + 1) + "</td>" +
        '<td class="nowrap">' + esc(thaiDate(j.receivedDate)) + "</td>" +
        "<td>" + esc(typeLabel(j)) + "</td>" +
        '<td class="nowrap">' + esc(formatTaxId(j.taxId)) + "</td>" +
        '<td title="' + esc(auditText(j)) + '">' + esc(j.name) + "</td>" +
        "<td>" + esc(fullAddress(j)) + "</td>" +
        '<td class="num">' + money(j.refundAmount) + "</td>" +
        '<td class="nowrap">' + esc(j.team) + "</td>" +
        "<td>" + esc(j.note) + "</td>" +
        '<td class="col-actions nowrap">' +
          '<button class="small" data-edit="' + esc(j.id) + '">แก้ไข</button> ' +
          '<button class="small danger" data-del="' + esc(j.id) + '">ลบ</button>' +
        "</td></tr>"
      ).join("");
    }
    $("sumCount").textContent = rows.length.toLocaleString("th-TH");
    $("sumAmount").textContent = money(rows.reduce((s, j) => s + (Number(j.refundAmount) || 0), 0));

    document.querySelectorAll("th[data-sort]").forEach((th) => {
      const base = th.textContent.replace(/ [▲▼]$/, "");
      th.textContent = base + (th.dataset.sort === sortKey ? (sortDir === 1 ? " ▲" : " ▼") : "");
    });
  }

  $("tbody").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.edit) startEdit(b.dataset.edit);
    if (b.dataset.del) remove(b.dataset.del);
  });
  document.querySelectorAll("th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      if (sortKey === th.dataset.sort) sortDir = -sortDir;
      else { sortKey = th.dataset.sort; sortDir = 1; }
      render();
    });
  });
  ["fSearch", "fType", "fTeam", "fFrom", "fTo"].forEach((id) =>
    $(id).addEventListener("input", render));

  // ---------- export / backup ----------
  function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }
  function csvCell(v) {
    const s = String(v == null ? "" : v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  $("exportCsvBtn").addEventListener("click", () => {
    const rows = filtered();
    if (!rows.length) { toast("ไม่มีข้อมูลให้ส่งออก"); return; }
    const header = ["ลำดับ", "วัน เดือน ปี รับงาน", "ประเภทการตรวจ", "เลขประจำตัวผู้เสียภาษี",
                    "ชื่อ", "เลขที่", "อาคาร", "ชั้น", "ซอย", "ถนน", "แขวง/ตำบล", "เขต/อำเภอ",
                    "จังหวัด", "รหัสไปรษณีย์", "ที่อยู่เต็ม", "จำนวนเงินคืนภาษี", "ทีม", "หมายเหตุ", "ผู้บันทึก"];
    const lines = [header.map(csvCell).join(",")];
    rows.forEach((j, i) => {
      lines.push([
        i + 1, thaiDate(j.receivedDate), typeLabel(j),
        // ใส่ ="..." เพื่อไม่ให้ Excel ตัดเลข 0 นำหน้า / แปลงเป็นเลขยกกำลัง
        '="' + j.taxId + '"',
        j.name,
        ...ADDR_FIELDS.map((f) => j[f] || ""),
        fullAddress(j), Number(j.refundAmount || 0).toFixed(2), j.team, j.note, j.createdBy,
      ].map(csvCell).join(","));
    });
    // BOM เพื่อให้ Excel อ่านภาษาไทยถูกต้อง
    download("รับงานใหม่_นต03_" + todayISO() + ".csv", "﻿" + lines.join("\r\n"), "text/csv;charset=utf-8");
  });

  $("printBtn").addEventListener("click", () => {
    $("printDate").textContent = "พิมพ์เมื่อ " + thaiDate(todayISO());
    window.print();
  });

  $("backupBtn").addEventListener("click", () => {
    const out = jobs.map((j) => Object.assign({}, j, {
      createdAt: j.createdAt ? new Date(j.createdAt).toISOString() : undefined,
      updatedAt: j.updatedAt ? new Date(j.updatedAt).toISOString() : undefined,
    }));
    download("backup_นต03_" + todayISO() + ".json", JSON.stringify(out, null, 2), "application/json");
  });

  // แปลงข้อมูลจากไฟล์สำรองให้ตรงกับรูปแบบที่ Firestore rules อนุญาต
  function importable(j, who) {
    const out = {};
    fields.forEach((f) => { out[f] = f === "refundAmount" ? 0 : ""; });
    fields.concat(["address"]).forEach((f) => {
      if (j[f] != null && f !== "refundAmount") out[f] = String(j[f]).slice(0, 1000);
    });
    out.taxId = digitsOnly(j.taxId);
    const amt = parseAmount(j.refundAmount);
    out.refundAmount = isNaN(amt) ? 0 : amt;
    if (!out.address) delete out.address;
    out.createdAt = serverTimestamp();
    out.createdBy = who;
    return out;
  }

  $("restoreBtn").addEventListener("click", () => $("restoreFile").click());
  $("restoreFile").addEventListener("change", (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      let data;
      try { data = JSON.parse(reader.result); } catch (err) { alert("ไฟล์ไม่ถูกต้อง"); return; }
      if (!Array.isArray(data)) { alert("รูปแบบไฟล์สำรองไม่ถูกต้อง"); return; }
      const existing = new Set(jobs.map((j) => j.id));
      const items = data.filter((j) => j && /^[A-Za-z0-9_-]{1,100}$/.test(String(j.id)) &&
                                       /^\d{4}-\d{2}-\d{2}$/.test(j.receivedDate) &&
                                       /^\d{13}$/.test(digitsOnly(j.taxId)) && !existing.has(String(j.id)));
      const skipped = data.length - items.length;
      if (!items.length) { alert("ไม่มีรายการใหม่ให้นำเข้า (ซ้ำหรือไม่ถูกต้อง " + skipped + " รายการ)"); return; }
      if (!confirm("นำเข้า " + items.length + " รายการ" +
                   (skipped ? " (ข้าม " + skipped + " รายการที่ซ้ำหรือไม่ถูกต้อง)" : "") + " ใช่หรือไม่?")) return;
      const who = currentUser.email || currentUser.uid;
      try {
        // Firestore จำกัด 500 รายการต่อ batch
        for (let i = 0; i < items.length; i += 400) {
          const batch = writeBatch(db);
          items.slice(i, i + 400).forEach((j) => batch.set(doc(db, "jobs", String(j.id)), importable(j, who)));
          await batch.commit();
        }
        toast("นำเข้าข้อมูล " + items.length + " รายการเรียบร้อย");
      } catch (err) {
        alert("นำเข้าไม่สำเร็จ: " + err.message);
      }
    };
    reader.readAsText(file, "utf-8");
  });

  // ---------- init ----------
  resetForm();
  render();
}
