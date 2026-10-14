# 🌌 کهکشان بازی آنلاین (مرحله ۱: شطرنج)

## ساختار پروژه
```
galaxy-online/
├─ package.json      ← لیست کتابخانه‌ها
├─ server.js         ← سرور (قوانین، ساعت، ELO، چت)
├─ public/index.html ← ظاهر سه‌بعدی بازی
└─ README.md         ← همین راهنما
```

## ۱) اجرا و تست روی کامپیوتر
1. از nodejs.org نسخه **LTS** را نصب کن.
2. پوشه پروژه را باز کن، در آن ترمینال (Terminal / CMD) بزن:
   ```
   npm install
   npm start
   ```
3. مرورگر را باز کن: `http://localhost:3000`
4. برای تست، **دو تب** باز کن، با دو نام مختلف وارد شو و «بازی سریع» بزن.
5. روی گوشی هم در همان وای‌فای: `http://آی‌پی-کامپیوتر:3000`

> اجرا مستقیم روی گوشی سخت است. ساده‌تر این است که مستقیم مرحله ۳ را انجام بدهی.

## ۲) آپلود در GitHub
1. در github.com ثبت‌نام کن و **New repository** بزن (نام: `galaxy-games`).
2. **Add file → Upload files** را بزن و `package.json`، `server.js` و `README.md` را بکش.
3. فایل `public/index.html` را با **Add file → Create new file** بساز؛ اسم فایل را دقیقاً `public/index.html` بنویس، محتوا را Paste کن و Commit بزن.
4. پوشه `node_modules` را **آپلود نکن**.

## ۳) انتشار روی Railway
1. به railway.app برو و با GitHub وارد شو.
2. **New Project → Deploy from GitHub repo** → مخزن `galaxy-games`.
3. بعد از ساخت: **Settings → Networking → Generate Domain**. لینک https آماده است. 🎉
4. برای اینکه امتیازها با هر انتشار پاک نشوند: **Add Volume** با مسیر `/data` بساز و در **Variables** این را اضافه کن: `DB_PATH` = `/data/data.db`

(Render هم مشابه است: New → Web Service → Build: `npm install` → Start: `npm start`)

## ۴) وصل کردن دامنه
1. دامنه بخر (مثلاً از namecheap).
2. در Railway: **Settings → Networking → Custom Domain** را بزن و دامنه را بنویس.
3. Railway یک مقدار **CNAME** می‌دهد؛ آن را در بخش DNS شرکت دامنه اضافه کن.
4. چند دقیقه تا چند ساعت صبر کن؛ https خودکار فعال می‌شود.

## ۵) نکات مهم
- سایت باید https باشد (Railway/Render خودکار انجام می‌دهند).
- سرور پورت را از `process.env.PORT` می‌خواند، چیزی را عوض نکن.
- لیست کلمات بد در `server.js` (متغیر `BAD`) است؛ خودت کامل‌ترش کن.
- رمز کاربران با bcryptjs هش می‌شود (نسخه بدون نیاز به نصب جداگانه bcrypt).
