/* v5.11.21: голосовий ввід на панелі файлів + редизайн upload-панелі.
   Патерни з досліджень 2026: mic поруч із полем (Telegram/ChatGPT mobile),
   прев'ю вкладень з типом/розміром і кнопкою видалення до відправки. */
import fs from "node:fs";
function ok(v,msg){if(!v)throw new Error("FAIL: "+msg);console.log("✓",msg)}
const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
const css=fs.readFileSync(new URL("../styles.css",import.meta.url),"utf8");
const app=fs.readFileSync(new URL("../app.js",import.meta.url),"utf8");

// 1. Кнопка мікрофона поруч із полем завдання на сторінці файлів
ok(html.includes('id="fileVoiceBtn"'),"fileVoiceBtn існує в index.html");
ok(html.indexOf('id="fileVoiceBtn"')>html.indexOf('id="filePrompt"'),"mic після filePrompt у DOM");
ok(/id="fileVoiceBtn"[^>]*class="[^"]*composerToolBtn[^"]*voiceTool[^"]*"/.test(html),"fileVoiceBtn використовує ті самі класи, що й чатовий mic");
ok(html.includes('id="fileVoiceStatus"'),"fileVoiceStatus існує");
ok(html.includes('aria-label="Голосовий ввід"')||html.includes('data-i18n-aria="voiceAria"'),"mic має український aria-label/title");

// 2. Узагальнений голосовий рушій, прив'язаний до filePrompt
ok(app.includes("createVoiceInput({btnId:\"fileVoiceBtn\""),"фабрика voice прив'язана до fileVoiceBtn");
ok(app.includes("function startFileVoiceInput"),"startFileVoiceInput визначений");
ok(app.includes("I18N?.voiceLocale?.()||navigator.language||\"uk-UA\""),"мова розпізнавання = мова інтерфейсу (uk-UA/en-US)");
ok(app.includes("webkitSpeechRecognition"),"webkit fallback для Safari");
ok(app.includes("voiceUnavailable")&&app.includes("voiceMicDenied"),"дружні повідомлення про помилки");
ok(!/createVoiceInput[\s\S]{0,2000}rec\.start\(\)\.then/.test(app),"текст НЕ відправляється автоматично — лише в поле");

// 3. Прев'ю файлів: розмір + тег типу; зона завантаження згортається
ok(app.includes("function fmtFileSize"),"fmtFileSize визначений");
ok(app.includes("function fileTypeTag"),"fileTypeTag визначений");
ok(app.includes('size:f.size'),"розмір файлу зберігається у вкладенні");
ok(app.includes('classList.add("compact")')&&app.includes('classList.remove("compact")'),"uploadBox згортається/розгортається за наявністю файлів");
ok(app.includes("fmtFileSize(a.size)"),"розмір показаний у fileItem");
ok(css.includes(".fileComposer")&&css.includes(".fileVoiceBtn"),"CSS для fileComposer/fileVoiceBtn");
ok(css.includes(".uploadBox.compact"),"CSS для компактного стану");

// 4. Інтерфейс українською, мобайл
ok(!/🎤|🔊|🎙/.test(app.split("createVoiceInput")[1]||""),"жодних емодзі-мікрофонів у коді рушія");
ok(/fileVoiceBtn\{[^}]*width:56px/.test(css),"кнопка mic компактна для 390px");

// 6. Перемикач мови розпізнавання (UA/EN, за замовчуванням — мова інтерфейсу)
ok(html.includes('id="fileVoiceLangBtn"'),"fileVoiceLangBtn існує");
ok(html.indexOf('id="fileVoiceLangBtn"')>html.indexOf('id="fileVoiceBtn"'),"перемикач мови поруч із мікрофоном");
ok(html.includes('class="fileVoiceCol"'),"mic і перемикач у спільній колонці");
ok(app.includes("getLang:fileVoiceLangEffective"),"рушій бере мову з перемикача");
ok(app.includes('const FILE_VOICE_LANG_KEY="ai_bridge_file_voice_lang_v1"'),"вибір мови зберігається (localStorage)");
ok(app.includes("function cycleFileVoiceLang"),"цикл авто → UA → EN → авто");
ok(app.includes("I18N?.voiceLocale?.()||navigator.language"),"за замовчуванням — мова інтерфейсу");
ok(css.includes(".fileVoiceLangBtn")&&css.includes(".fileVoiceCol"),"CSS перемикача мови");
const i18n=fs.readFileSync(new URL("../i18n.js",import.meta.url),"utf8");
ok(i18n.includes('voiceLangTitle:"Мова голосового введення: {lang}. Натисни, щоб змінити."'),"uk: voiceLangTitle");
ok(i18n.includes('voiceLangTitle:"Voice input language: {lang}. Tap to change."'),"en: voiceLangTitle");

// 7. Безпека: жодних реальних секретних значень у коді (довгі ключі, PEM, присвоєння токенів)
ok(!/sk-[A-Za-z0-9_-]{16,}/.test(app),"немає OpenAI-подібних ключів");
ok(!/BEGIN (?:RSA |EC )?PRIVATE KEY/.test(app),"немає приватних ключів");
ok(!/(?:TOKEN|SECRET|PASSWORD)\s*[:=]\s*["'][A-Za-z0-9_-]{8,}["']/.test(app),"немає присвоєнь секретів");
ok(!/\b[A-Za-z0-9]{32,}\b/.test(app.split("createVoiceInput")[1]||""),"новий код не містить довгих токеноподібних рядків");
console.log("ALL v5.11.21 FILE-VOICE TESTS PASSED");
