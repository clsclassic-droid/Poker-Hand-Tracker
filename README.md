# 🃏 Poker Hand Tracker

เว็บแอปสำหรับบันทึกข้อมูล Poker Hands โดยบันทึกลง Google Sheets อัตโนมัติ

## ฟีเจอร์

- คลิกเลือกไพ่จาก grid 52 ใบ (4 สี × 13 แต้ม)
- บันทึก: Hand, Flop, Turn, River, SD1, SD2
- Auto-advance ไปฟิลด์ถัดไปเมื่อเลือกไพ่ครบ
- ไพ่ที่ใช้แล้วจะเป็นสีเทา ป้องกันการเลือกซ้ำ
- ดูประวัติ 25 hand ล่าสุดในหน้าเดียวกัน
- เชื่อมต่อ Google Sheets โดยตรง — บันทึกข้อมูลทันที

---

## วิธีติดตั้ง

### ขั้นตอนที่ 1 — สร้าง Google Cloud Project

1. ไปที่ [console.cloud.google.com](https://console.cloud.google.com/)
2. สร้าง Project ใหม่ (ชื่ออะไรก็ได้)
3. เปิดใช้งาน APIs สองตัว:
   - **Google Sheets API**
   - **Google Drive API**

### ขั้นตอนที่ 2 — สร้าง API Key

1. ไปที่ **APIs & Services → Credentials**
2. คลิก **Create Credentials → API Key**
3. คัดลอก API Key ที่ได้
4. (แนะนำ) คลิก Edit key แล้วกำหนด:
   - **Application restrictions**: HTTP referrers
   - เพิ่ม `https://<your-github-username>.github.io/*`
   - **API restrictions**: เลือกเฉพาะ Sheets API และ Drive API

### ขั้นตอนที่ 3 — สร้าง OAuth 2.0 Client ID

1. คลิก **Create Credentials → OAuth 2.0 Client IDs**
2. ถ้ายังไม่ได้ตั้ง Consent Screen — คลิก **Configure Consent Screen**:
   - User Type: **External**
   - กรอก App name ตามชอบ
   - เพิ่ม Scopes: `spreadsheets` และ `drive`
   - เพิ่ม Test users: ใส่ Gmail ของตัวเอง
3. กลับมาสร้าง OAuth 2.0 Client ID:
   - Application type: **Web application**
   - Authorized JavaScript origins: `https://<your-github-username>.github.io`
   - (สำหรับทดสอบ local): เพิ่ม `http://localhost` และ `http://localhost:5500`
4. คัดลอก **Client ID** ที่ได้

### ขั้นตอนที่ 4 — ใส่ Credentials ในโปรเจกต์

แก้ไขไฟล์ `config.js`:

```js
const CONFIG = {
    CLIENT_ID: 'xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com',
    API_KEY:   'AIzaXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
};
```

### ขั้นตอนที่ 5 — Push ขึ้น GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/<username>/<repo-name>.git
git push -u origin main
```

### ขั้นตอนที่ 6 — เปิด GitHub Pages

1. ไปที่ Repository → **Settings → Pages**
2. Source: **Deploy from a branch**
3. Branch: **main / (root)**
4. บันทึก — รอสักครู่แล้วเข้าที่ `https://<username>.github.io/<repo-name>/`

---

## โครงสร้าง Google Sheet

แอปจะค้นหา spreadsheet ในโฟลเดอร์ "Poker Hand Tracker" ใน Google Drive อัตโนมัติ
หากไม่พบจะสร้างไฟล์ใหม่ให้

| คอลัมน์ | ข้อมูล | ตัวอย่าง |
|---------|--------|---------|
| A | No. | 1 |
| B | Hand | As Kh |
| C | Flop | Jd Tc 9s |
| D | Turn | 8h |
| E | River | 7c |
| F | SD1 | Qd Js |
| G | SD2 | Th 9d |

สัญลักษณ์ไพ่: `s`=♠ `h`=♥ `d`=♦ `c`=♣, `T`=Ten

---

## ทดสอบ Local

ใช้ VS Code Live Server หรือ:

```bash
npx serve .
```

แล้วเปิด `http://localhost:5000`

> **หมายเหตุ**: ต้องเพิ่ม `http://localhost:5000` ใน Authorized JavaScript origins ใน Google Cloud Console ด้วย
