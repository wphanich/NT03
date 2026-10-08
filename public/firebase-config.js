// ค่าการเชื่อมต่อ Firebase — คัดลอกจาก Firebase Console:
// Project settings > General > Your apps > Web app > SDK setup and configuration > Config
// (ค่าเหล่านี้ไม่ใช่ความลับ ความปลอดภัยของข้อมูลควบคุมด้วย firestore.rules)
export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};
