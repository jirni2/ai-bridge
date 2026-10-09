/* AI Bridge Core v5.11.103 — локальний движок аналізу тексту + самостійний Асистент.
   v5.11.103: tokenize() — дефіс між літерами лишається всередині токена (тейлоринг
   UAX #29: U+002D/U+2010/U+2011 як MidLetter — стандарт дозволяє таке для індексації;
   дефолтний UAX #29 дефіс розриває): «бізнес-план», «будь-який», «well-known» — один
   токен; дефіс біля цифр/пробілів і тире — як раніше розрив; U+2010/U+2011 → U+002D.
   keyphrases() — ті самі правила (спільний __splitWords).
   v5.11.99: keyphrases() — витяг багатослівних ключових фраз за RAKE (Rose et al., 2010):
   кандидати = послідовності змістовних слів між стоп-словами/межами речень,
   score(w)=deg(w)/freq(w), оцінка фрази = сума оцінок слів. Детерміновано,
   чистий JS, zero dependencies.
   v5.11.95: createAssistant() — розуміє намір, рахує, переводить одиниці, працює з датами і
   текстом, має пам'ять (факти, документи, нотатки), веде розмову, оцінює власну впевненість
   і сам сигналить, коли питання треба передати хмарному AI. Див. блок «АСИСТЕНТ ЯДРА».
   39 модулів покращення від команди з 40 агентів (2026-10-04).
   v5.11.93 (аудит ядра, A/B на двох наборах питань: топ-1 36→41 із 42 і 26→34 із 35):
   • splitSentences — абзаци/списки/заголовки як окремі речення, межа перед цифрою, скорочення
     та ініціали; лінійний прохід (серія з 50 000 крапок: 6 с → мс).
   • stemMatch — відмінювання коротких слів (торт/торта, масло/масла) без хибних збігів
     (програма/прогрес, international/internet); токени з цифрами — лише точний збіг.
   • answer — tokenizeQA (коди P0300, роки, версії, абревіатури ШІ/KV), бонус типу відповіді
     (коли/скільки/телефон/email), без повторів однакових речень, стійкий розбір n.
   • detectLang — словникові маркери справді працюють (\b не бачить кирилицю): 14→21 із 21.
   • keywords — форми одного слова зливаються; stats.avgSentenceLen — справжні слова/речення.
   • analyze — розрізи частин на межі слова (analyzeChunkRanges), чесний прапорець truncated.
   • splitSentencesSmart — 66 с на рядку з 60 000 літер → мс; findParaphrases — ліміт 600 речень.
   v5.11.91: analyze() — збалансований бюджет резюме по чанках (head/middle/tail ≈33/34/33):
   top-1 речення КОЖНОГО чанка, у резюме йдуть [перший, середній, останній]; висновок
   довгого документа більше не губиться. ≤3 чанків — результат ідентичний старому.
   v5.11.85: answer() — бонус покриття термінів запиту (1+matched/qTerms) поверх BM25:
   речення з усіма термінами запиту б'є речення з одним частим рідкісним терміном.
   v5.11.82: summarize() — lead-bias позиційна вага (leadBiasPos: лід 2.0,
   перші 20% 1.5, висновок 1.3, спад до 0.7 у довгих текстах) замість 1.5/1.0/0.6.
   v5.11.78: tokenize() — апостроф усередині слова (UAX #29): ім'я, м'яч, don't.
   v5.11.76: answer() на BM25 (Okapi) — IDF по реченнях, tf через stemMatch, довжинна нормалізація.
   v5.11.75 «Захист Ядра»: DoS-ліміти, бюджет часу, verifyIntegrity(), safe-обгортки.
   Чистий JavaScript, zero dependencies. Працює офлайн у браузері.
   НЕ є LLM і не імітує його: це екстрактивний аналізатор —
   резюме, ключові слова, статистика, пошук відповідей у заданому тексті.
   НІЯКИХ мережевих викликів. */
const BridgeCore=(()=>{
"use strict";
const VERSION="5.11.104";

/* === v5.11.75 «Захист Ядра» — чистий JS, zero dependencies. ===
   1. DoS-захист: ліміт вхідного тексту (MAX_INPUT_CHARS) + бюджет часу (TIME_BUDGET_MS).
      Понад ліміт — чесна CoreError("tooLarge"), а не зависання.
   2. Цілісність: verifyIntegrity() порівнює хеш ключових функцій з базовою лінією
      на момент завантаження. Розбіжність = підміна в рантаймі → console.warn.
      (Не захист від цілеспрямованого злому — ловить CDN-ін'єкції, пошкодження,
      наївну підміну; зловмисник, що перепише й verifyIntegrity, не детектиться.)
   3. Безпечне виконання: всі публічні функції обгорнуті в try/catch —
      жодна помилка не роняє застосунок. Чесні CoreError прокидаються нагору.
   4. Санітизація: escapeHtml() для виводу; app.js додатково екранує через esc(). */
const MAX_INPUT_CHARS=500000;
const TIME_BUDGET_MS=10000;

/* Чесна помилка ядра: прокидається крізь safe-обгортки без перетворення на fallback. */
function CoreError(code,detail){
  const e=new Error("BridgeCore: "+code+(detail?" ("+detail+")":""));
  e.isCoreError=true;e.code=code;return e;
}

/* DoS-гард: відхилити надто великий вхід ДО обробки. O(1). */
function guardInput(text){
  const t=String(text==null?"":text);
  if(t.length>MAX_INPUT_CHARS)throw CoreError("tooLarge",t.length+" > "+MAX_INPUT_CHARS);
  return t;
}

/* Бюджет часу: check() кидає CoreError("timeout") після вичерпання.
   Перевірка часу — лише кожен 64-й виклик, щоб не сповільнювати цикл. */
function makeBudget(ms){
  const start=Date.now(),limit=(typeof ms==="number"&&ms>0)?ms:TIME_BUDGET_MS;
  let checks=0;
  return{check(){if((++checks&63)===0&&Date.now()-start>limit)throw CoreError("timeout");}};
}

/* Екранування HTML у виводі аналізу. */
function escapeHtml(s){
  return String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

/* Стоп-слова: uk / en / ru. Короткий практичний набір. */
const STOP=new Set(("а,але,бо,був,була,були,було,буде,будуть,в,вас,весь,від,він,вона,вони,воно,все,всіх,ви,для,до,де,ж,же,з,за,й,його,її,їх,і,із,чи,як,яка,який,які,яку,мене,мені,ми,на,над,нас,не,немає,ні,о,об,ось,під,по,про,с,свій,своя,свої,так,таки,там,те,ти,то,тобто,тоді,тільки,у,це,цей,ця,ці,цю,що,щоб,я,йому,тебе,нього,неї,коли,якщо,або,надто,вже,ще,також,між,через,при,без,кожен,кожна,інший,інша,саме,лише,навіть,дуже,більше,менше,можна,треба,будуть,бути,є,нема,от,он,ось"+
",the,a,an,and,or,but,if,then,else,when,at,by,for,with,about,into,through,during,before,after,above,below,to,from,up,down,in,out,on,off,over,under,again,further,once,here,there,all,any,both,each,few,more,most,other,some,such,no,nor,not,only,own,same,so,than,too,very,can,will,just,should,now,is,are,was,were,be,been,being,have,has,had,having,do,does,did,doing,would,could,ought,i,you,he,she,it,we,they,them,their,this,that,these,those,am,as,of,its,my,your,his,her,our"+
",а,но,или,если,то,тогда,так,также,вот,вон,это,эта,эти,этот,к,ко,в,во,на,над,под,о,об,от,до,для,при,без,через,между,из,у,с,со,не,ни,нет,да,же,ж,ли,бы,б,ведь,вон,там,тут,здесь,как,какой,какая,какие,который,которая,которые,что,чтобы,кто,меня,мне,мы,нас,вы,вас,он,она,они,его,ее,их,тебя,себя,мой,моя,мое,мои,твой,твоя,свой,своя,наш,ваш,весь,вся,все,каждый,другой,сам,сама,уже,еще,только,лишь,даже,очень,более,менее,можно,нужно,есть,быть,был,была,были,было,будет,будут,него,нее,когда,или").split(","));

/* Розбити текст на речення. */
function splitSentences(text){
  /* v5.11.93: 1) абзаци, пункти списків і заголовки — окремі «речення» (раніше всі переноси
     рядків зливались, і список без крапок ставав одним гігантським реченням); рядки,
     перенесені посеред речення, склеюються. 2) межа також перед цифрою («…яблук. 3 з них…»).
     3) не рветься після звертань і посилань (Mr., Dr., рис., див.), ініціалів (Т. Г.) і
     коротких скорочень перед числом (с. 10, п. 3). Один лінійний прохід, без backtracking. */
  const _t=guardInput(text).replace(/\r\n?/g,"\n");
  const out=[];
  for(const block of __splitBlocks(_t)){
    const src=block.replace(/\s+/g," ").trim();
    if(!src)continue;
    /* Ручний лінійний прохід: регулярка з «+» на довгих серіях крапок давала O(n²). */
    let start=0,i=0;const L=src.length;
    while(i<L){
      const ch=src.charCodeAt(i);
      if(ch!==46&&ch!==33&&ch!==63&&ch!==8230){i++;continue;}   /* . ! ? … */
      const runStart=i;
      while(i<L){const c=src.charCodeAt(i);if(c===46||c===33||c===63||c===8230)i++;else break;}
      let j=i,closers=0;
      while(j<L&&closers<3&&__CLOSERS.indexOf(src.charAt(j))>=0){j++;closers++;}
      if(j>=L)break;
      if(src.charCodeAt(j)!==32){i=j>i?j:i;continue;}            /* після знака має бути пробіл */
      const nextIdx=j+1;
      if(nextIdx>=L)break;
      if(!__isSentenceStart(src,nextIdx))continue;
      if(i-runStart===1&&src.charCodeAt(runStart)===46&&__abbrBlocksBreak(src,runStart,src.charAt(nextIdx)))continue;
      const piece=src.slice(start,j).trim();
      if(piece.length>1)out.push(piece);
      start=nextIdx;i=nextIdx;
    }
    const tail=src.slice(start).trim();
    if(tail.length>1)out.push(tail);
  }
  return out;
}
const __CLOSERS="\"»”)]";
const __LIST_LINE_RE=/^(?:[-*•–—]\s+|\d{1,3}[.)]\s+|#{1,6}\s+|>\s+)/;
const __BULLET_STRIP_RE=/^(?:[-*•–—]\s+|#{1,6}\s+|>\s+)/;
/* Звертання й посилання, після яких крапка НІКОЛИ не закінчує речення. */
const __ABBR_NEVER_END=new Set("mr,mrs,ms,dr,prof,st,vs,fig,no,e.g,i.e,cf,ім,вул,проф,доц,акад,тов,див,рис,табл,напр,им,ул,см,гр".split(","));
function __isSentenceStart(src,i){
  let c=src.charAt(i);
  if(/["«“(\[]/.test(c))c=src.charAt(i+1);
  return /[\p{Lu}\p{N}]/u.test(c);
}
function __abbrBlocksBreak(src,dotIdx,next){
  /* слово безпосередньо перед крапкою */
  let a=dotIdx;while(a>0&&/[\p{L}.]/u.test(src.charAt(a-1))&&dotIdx-a<12)a--;
  const word=src.slice(a,dotIdx);
  if(!word)return false;
  const low=word.toLowerCase();
  if(__ABBR_NEVER_END.has(low))return true;
  /* ініціал: одна велика літера («Т. Г. Шевченко») */
  if(word.length===1&&/\p{Lu}/u.test(word)&&/\p{Lu}/u.test(next))return true;
  /* коротке скорочення малими перед числом: «с. 10», «п. 3», «ст. 12», «т. 2» */
  if(/\p{N}/u.test(next)&&word.length<=3&&word===low&&/^\p{L}+$/u.test(word))return true;
  return false;
}
/* Розбити текст на блоки за структурою рядків. */
function __splitBlocks(t){
  if(t.indexOf("\n")<0)return[t];
  const blocks=[];let cur="",prev="";
  const flush=()=>{if(cur.trim())blocks.push(cur.trim().replace(__BULLET_STRIP_RE,""));cur="";prev="";};
  for(const raw of t.split("\n")){
    const line=raw.trim();
    if(!line){flush();continue;}
    if(__LIST_LINE_RE.test(line)){flush();cur=line;prev=line;continue;}
    if(cur){
      const ended=/[.!?…:;]["»”)\]]?$/.test(prev);
      const shortPrev=prev.length<50&&/^["«“(\[]?[\p{Lu}\p{N}]/u.test(line);
      if(ended||shortPrev){flush();cur=line;}
      else cur+=" "+line;
    }else cur=line;
    prev=line;
  }
  flush();
  return blocks;
}

/* Токенізація: літери (unicode), нижній регістр, без стоп-слів і сміття.
   v5.11.78: апостроф усередині слова — частина слова (UAX #29, як в Intl.Segmenter):
   «ім'я», «м'яч», «п'єса», «don't» більше не розриваються на сміття;
   крайові апострофи («'цитата'») зрізаються.
   v5.11.103: дефіс МІЖ ЛІТЕРАМИ — частина слова (тейлоринг UAX #29: U+002D/U+2010/U+2011
   як MidLetter — стандарт прямо дозволяє таке налаштування для індексації/пошуку;
   дефолтний UAX #29, як і Intl.Segmenter, дефіс розриває): «бізнес-план», «будь-який»,
   «well-known», «state-of-the-art» — один токен, а не розірвані частини; дефіс біля
   цифр («10-20», «COVID-19»), пробілів чи на краю слова — як раніше розрив;
   тире (—, –, −) — як раніше розрив. U+2010/U+2011 канонізуються до U+002D
   для детермінізму. */
const __HYPH_IN=/([\p{L}])[-\u2010\u2011](?=[\p{L}])/gu; /* тейлоринг UAX #29: ці дефіси як MidLetter (WB6/WB7) */
const __HYPH_PH="\uE000";                               /* плейсхолдер (private-use) */
/* Спільний низькорівневий розбір слів для tokenize()/keyphrases(): викликач вже
   зробив toLowerCase; повертає сирі слова (порожні відфільтровано). */
function __splitWords(lower){
  return lower.replace(__HYPH_IN,"$1"+__HYPH_PH)
    .replace(/[^\p{L}\p{N}'\u2019\u02BC\uE000]+/gu," ")
    .split(" ")
    .map(w=>w.replace(/^['\u2019\u02BC\uE000-]+|['\u2019\u02BC\uE000-]+$/g,"").replace(/\uE000/g,"-").trim())
    .filter(w=>w.length>0);
}
function tokenize(text){
  const _t=guardInput(text);
  return __splitWords(_t.toLowerCase())
    .filter(w=>w.length>2&&!STOP.has(w)&&!/\d/.test(w));
}

function wordFreq(tokens){
  const m=new Map();
  for(const w of tokens)m.set(w,(m.get(w)||0)+1);
  return m;
}

/* Спільний префікс ≥5 символів — груба нормалізація для слов'янської морфології
   («мрії»/«мрія», «плани»/«планів»). */
function stemMatch(a,b){
  /* v5.11.93: стара умова «спільний префікс ≥5» (а) не бачила коротких слів — «торт/торта»,
     «масло/масла», «мрії/мрія», «test/tests»; (б) плутала різні слова зі спільним початком —
     «програма/прогрес», «international/internet». Тепер два правила:
     A — відмінювання: слова різняться лише коротким закінченням;
     B — спільна основа: довгий префікс, що покриває більшу частину довшого слова.
     Токени з цифрами (коди, версії, роки) збігаються лише точно. */
  if(a===b)return true;
  if(!a||!b)return false;
  if(__HAS_DIGIT_RE.test(a)||__HAS_DIGIT_RE.test(b))return false;
  const la=a.length,lb=b.length,n=la<lb?la:lb,m=la<lb?lb:la;
  if(n<3)return false;
  let p=0;while(p<n&&a.charCodeAt(p)===b.charCodeAt(p))p++;
  if(p<3)return false;
  if(p>=6&&p/m>=0.6)return true;                      /* B: довга спільна основа */
  const ta=a.slice(p),tb=b.slice(p);
  if(ta.length>3||tb.length>3)return false;
  const latin=__LATIN_WORD_RE.test(a)&&__LATIN_WORD_RE.test(b);
  const infl=latin
    ?(t,stem)=>t===""||__EN_TAILS.has(t)||(t==="d"&&stem.endsWith("e"))
    :(t)=>__CYR_TAIL_RE.test(t)||__CYR_VERB_TAILS.has(t);
  if(!infl(ta,a.slice(0,p))||!infl(tb,b.slice(0,p)))return false;
  if(p>=5&&p/m>=0.55)return true;                     /* C: основа + типові закінчення */
  if(p===3&&(ta.length>1||tb.length>1))return false;
  return n-p<=1;                                      /* A: відмінювання короткого слова */
}
const __HAS_DIGIT_RE=/\d/;
const __LATIN_WORD_RE=/^[a-z']+$/;
const __EN_TAILS=new Set(["s","es","ed","ing","ly","'s","er","ers","al","ion","y","ies"]);
const __CYR_VERB_TAILS=new Set(["ти","ити","ати","яти","ть","ить","ать","ять","ла","ло","ли","ють","ємо","єш","ешь","ет","ют"]);
const __CYR_TAIL_RE=/^[аеєиіїоуюяьйвмхы]*$/;

/* Визначити мову: uk / ru / en. */
function detectLang(text){
  /* v5.11.93: у старій версії \b не працює з кирилицею в JS, тому словникові маркери ніколи
     не спрацьовували і мова визначалась лише за літерами іїєґ / ыъэ: «Привет, как дела?»
     вважалось українською. Тепер: межі слів через Unicode, більші словники, типові закінчення. */
  const t=guardInput(text);
  if(!t.trim())return "en";
  const sample=t.length>20000?t.slice(0,20000):t;
  const cyr=(sample.match(/[Ѐ-ӿ]/g)||[]).length;
  const lat=(sample.match(/[a-zA-Z]/g)||[]).length;
  if(lat>cyr*3)return "en";
  if(cyr===0)return "en";
  const low=sample.toLowerCase();
  let uk=((low.match(/[іїєґ]/g)||[]).length)*3;
  let ru=((low.match(/[ыъэё]/g)||[]).length)*3;
  const words=low.match(/[Ѐ-ӿ'’ʼ]+/g)||[];
  for(const w of words){
    if(__UK_WORDS.has(w))uk+=2;else if(__RU_WORDS.has(w))ru+=2;
    if(w.length>=4){
      if(__RU_END_RE.test(w))ru+=1;
      else if(__UK_END_RE.test(w))uk+=1;
    }
  }
  if(uk===0&&ru===0)return lat>cyr?"en":"uk";
  return uk>=ru?"uk":"ru";
}
const __UK_WORDS=new Set("що,який,яка,які,яке,це,цей,ця,ці,але,вже,також,буде,можна,треба,дуже,тільки,як,де,коли,чому,або,якщо,та,й,чи,є,був,була,були,від,до,для,про,при,над,під,між,через,після,перед,тому,тут,там,зараз,потім,ще,так,ні,він,вона,вони,ми,ви,мене,тебе,його,її,наш,ваш,свій,хто,скільки,привіт,дякую,будь,ласка,добре,сьогодні,завтра,вчора,робити,мати,бути,знати,хочу,можу,треба,немає,дуже,зі,із,з".split(","));
const __RU_WORDS=new Set("что,который,которая,которые,которое,это,этот,эта,эти,но,уже,также,будет,можно,нужно,очень,только,как,где,когда,почему,или,если,и,ли,есть,был,была,были,от,для,про,при,над,под,между,через,после,перед,потому,поэтому,здесь,там,сейчас,потом,ещё,еще,да,нет,он,она,они,мы,вы,меня,тебя,его,её,ее,наш,ваш,свой,кто,сколько,привет,спасибо,пожалуйста,хорошо,сегодня,завтра,вчера,делать,иметь,быть,знать,хочу,могу,надо,дела,с,со,к,ко,о,об,во".split(","));
/* Закінчення, типові лише для однієї з мов. */
const __RU_END_RE=/(?:ает|яет|ует|ают|яют|уют|ешь|ишь|ить|ать|ять|еть|уть|тся|ние|ния|ией|щь|шь|ое|ее|ие|ый|ого|его|ому|ему)$/;
const __UK_END_RE=/(?:ити|ати|яти|ути|ють|ння|нням|ого|ому|ою|ій|их|ими|ові|еві)$/;

/* Статистика тексту. */
function stats(text){
  const t=guardInput(text);
  const sentences=splitSentences(t);
  const tokens=tokenize(t);
  const rawWords=t.trim()?t.trim().split(/\s+/).length:0;
  const avgSent=sentences.length?(tokens.length/sentences.length):0;
  const avgWord=tokens.length?(tokens.reduce((a,w)=>a+w.length,0)/tokens.length):0;
  const unique=new Set(tokens).size;
  /* Складність 0..100: довгі речення + довгі слова + низька унікальність. */
  const complexity=Math.min(100,Math.round(avgSent*2.2+avgWord*4+(tokens.length?Math.max(0,(1-unique/tokens.length))*30:0)));
  return{
    chars:t.length,
    words:rawWords,
    sentences:sentences.length,
    /* v5.11.93: раніше ділились токени БЕЗ стоп-слів і коротких слів — «середня довжина речення»
       виходила вдвічі меншою за справжню. Складність рахується як раніше (сумісність). */
    avgSentenceLen:+(sentences.length?rawWords/sentences.length:0).toFixed(1),
    avgWordLen:+avgWord.toFixed(1),
    uniqueWords:unique,
    complexity
  };
}

/* Топ-N ключових слів за частотою. */
function keywords(text,n){
  n=__clampInt(n,10,1,30);
  guardInput(text);
  const freq=wordFreq(tokenize(text));
  return __groupWordForms([...freq.entries()]
    .sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])))
    .slice(0,n)
    .map(([word,count])=>({word,count}));
}
/* v5.11.93: форми одного слова («документ», «документи», «документів») зливаються в одне
   ключове слово з найчастішою формою як назвою — раніше вони займали по окремому місцю
   в топі. Групуються лише перші 300 кандидатів (лінійно для великих текстів). */
function __groupWordForms(sorted){
  const LIMIT=300,groups=[];
  const head=sorted.length>LIMIT?sorted.slice(0,LIMIT):sorted;
  for(const [w,c] of head){
    let g=null;
    for(let i=0;i<groups.length;i++){if(stemMatch(groups[i][0],w)){g=groups[i];break;}}
    if(g)g[1]+=c;else groups.push([w,c]);
  }
  groups.sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
  return groups;
}

/* Ключові фрази (multi-word) — RAKE (Rose et al., 2010), чистий JS.
   v5.11.99: доповнює keywords() (одиночні токени) і summarize() (речення) —
   витягає багатослівні терміни на кшталт «машинне навчання», «штучний інтелект».
   Алгоритм: текст → речення (роздільники фраз) → кандидати = максимальні
   послідовності змістовних токенів, розділені стоп-словами (той самий набір STOP,
   що в tokenize()); score(w)=deg(w)/freq(w), де deg — сума довжин кандидатів
   зі словом (співвходження включно із самим словом); оцінка фрази — сума
   оцінок слів. Детерміновано: сортування за оцінкою ↓, довжиною ↓, лексикографічно.
   Тайм-аут — частковий результат (як summarize); tooLarge — чесна CoreError. */
function keyphrases(text,n){
  n=__clampInt(n,10,1,30);
  const t=guardInput(text);
  const budget=makeBudget();
  const sentences=splitSentences(t);
  /* Кандидати: послідовності змістовних слів (ті самі правила, що в tokenize:
     довжина>2, не стоп-слово, без цифр). Межа фрази — стоп-слово або речення. */
  const cand=[];let cur=[],i=0;
  const flush=()=>{if(cur.length){cand.push(cur);cur=[];}};
  try{
    for(const s of sentences){
      /* v5.11.103: ті самі правила, що в tokenize() — включно з дефісом між літерами (UAX #29). */
      const toks=__splitWords(s.toLowerCase());
      for(const w of toks){
        if(w.length>2&&!STOP.has(w)&&!__HAS_DIGIT_RE.test(w))cur.push(w);
        else flush();
      }
      flush();
      if((++i&255)===0)budget.check();
    }
  }catch(e){if(!e||!e.isCoreError)throw e;} /* timeout → рахуємо з того, що зібрали */
  /* RAKE-скоринг. */
  const freq=new Map(),deg=new Map();
  for(const c of cand){
    for(const w of c){
      freq.set(w,(freq.get(w)||0)+1);
      deg.set(w,(deg.get(w)||0)+c.length);
    }
  }
  const wordScore=new Map();
  for(const [w,f] of freq)wordScore.set(w,deg.get(w)/f);
  const seen=new Map(); /* фраза → оцінка (та сама фраза = ті самі слова = та сама оцінка) */
  for(const c of cand){
    const phrase=c.join(" ");
    if(seen.has(phrase))continue;
    let sc=0;for(const w of c)sc+=wordScore.get(w);
    seen.set(phrase,{phrase,score:sc,len:c.length});
  }
  return [...seen.values()]
    .sort((a,b)=>b.score-a.score||b.len-a.len||a.phrase.localeCompare(b.phrase))
    .slice(0,n)
    .map(({phrase,score})=>({phrase,score:+score.toFixed(3)}));
}

/* Екстрактивне резюме: оцінка речень за позицією, частотою слів, довжиною.
   v5.11.75: бюджет часу — при вичерпанні повертає частковий результат. */
/* Вага позиції речення i (0-based) серед total — lead-bias для резюме.
   v5.11.82: винесено з summarize(); крива — за зразком scoreSentencePosition
   (imp-модуль #7, A/B-перевірено в прогоні #3): лід 2.0, перші 20% 1.5,
   висновок 1.3, середина 1.0 зі спадом до 0.7 у довгих текстах (≥8 речень).
   Замінює грубий posBonus 1.5/1.0/0.6 (останнє речення більше не штрафується).
   Невалідні входи → нейтральні 1.0, без винятків. */
function leadBiasPos(i,total){
  if(!Number.isFinite(i)||!Number.isFinite(total)||total<=0)return 1.0;
  i=Math.floor(i);
  if(i<0||i>=total)return 1.0;
  if(i===0)return 2.0;
  if(i===total-1)return 1.3;
  if(i/total<0.2)return 1.5;
  if(total<8)return 1.0;
  const start=Math.ceil(total*0.2),end=total-2;
  if(end<=start)return 1.0;
  const depth=(i-start)/(end-start);
  return +(1.0-depth*0.3).toFixed(2);
}

function summarize(text,maxSentences){
  maxSentences=__clampInt(maxSentences,3,1,10);
  guardInput(text);
  const budget=makeBudget();
  const sentences=splitSentences(text);
  if(!sentences.length)return[];
  if(sentences.length<=maxSentences)return sentences.slice();
  const freq=wordFreq(tokenize(text));
  const total=sentences.length;
  const scored=[];
  for(let i=0;i<sentences.length;i++){
    try{budget.check();}catch(e){break;} /* час вичерпано — частковий результат */
    const s=sentences[i];
    const toks=tokenize(s);
    if(!toks.length)continue;
    const freqSum=toks.reduce((a,w)=>a+(freq.get(w)||0),0)/toks.length;
    const posBonus=leadBiasPos(i,total);
    /* Штраф за надто короткі/довгі речення. */
    /* v5.11.93: 1–2 змістовні слова — це заголовок чи підпис, а не речення для резюме. */
    const lenPenalty=toks.length<3?0.15:(toks.length<4?0.4:(toks.length>40?0.7:1.0));
    const score=freqSum*posBonus*lenPenalty;
    if(score>0)scored.push({i,s,score});
  }
  return __topDistinct(scored,maxSentences);
}

/* v5.11.93: ціле число в межах [lo,hi]; NaN/рядок/Infinity → типове значення
   (раніше answer(q,ctx,"x") давало slice(0,NaN) і порожній результат). */
function __clampInt(v,def,lo,hi){
  v=Number(v);
  if(!Number.isFinite(v))v=def;
  v=Math.floor(v);
  return v<lo?lo:(v>hi?hi:v);
}
/* Токенізація для пошуку відповідей: як tokenize, але лишає токени з цифрами
   (коди, роки, версії «4.2.1», числа «12,4») і дволітерні абревіатури ВЕЛИКИМИ (ШІ, KV, ЄС). */
const __QA_TOKEN_RE=/[\p{L}\p{N}]+(?:['’ʼ][\p{L}]+)*(?:[.,\-][\p{N}]+)*/gu;
function tokenizeQA(text){
  const _t=guardInput(text);
  const out=[];
  let m;__QA_TOKEN_RE.lastIndex=0;
  while((m=__QA_TOKEN_RE.exec(_t))){
    const raw=m[0];
    if(raw.length>40)continue;                 /* не слово: довгі «ковбаси» літер лише гальмують пошук */
    const w=raw.toLowerCase();
    const hasDigit=__HAS_DIGIT_RE.test(w);
    if(hasDigit){if(w.length>=2||/^\d$/.test(w)&&false)out.push(w);continue;}
    if(w.length>2){if(!STOP.has(w))out.push(w);continue;}
    if(w.length===2&&raw===raw.toUpperCase()&&raw!==w)out.push(w);
  }
  /* v5.11.95: складені через дефіс слова додаються ще й злито: «Wi-Fi» ↔ «wifi», «e-mail» ↔ «email». */
  if(_t.indexOf("-")>=0){
    const hy=_t.match(/[\p{L}]+(?:-[\p{L}]+){1,3}/gu);
    if(hy)for(const h of hy){const j=h.toLowerCase().replace(/-/g,"");if(j.length>=3&&j.length<=24)out.push(j);}
  }
  return out;
}

/* Тип очікуваної відповіді за питальними словами (uk/ru/en). exact=true — шаблон настільки
   точний (телефон, email), що речення-кандидат допустиме навіть без спільних слів. */
const __QT=[
  {q:/телефон|номер\s+тел|phone|подзвон|позвон|\bcall\b/i,re:/\+?\d[\d\s().\-]{6,}\d/,exact:true},
  {q:/e-?mail|пошт|почт|емейл|імейл|имейл/i,re:/[\w.+\-]+@[\w\-]+\.[\w.]+/,exact:true},
  {q:/^\s*(?:коли|когда|when)(?![\p{L}])|о\s+котрій|во\s+сколько|what\s+time|якого\s+числа|какого\s+числа/iu,
   re:/\d{1,2}[:.]\d{2}|(?:19|20)\d{2}|січн|лют|березн|квітн|травн|червн|липн|серпн|вересн|жовтн|листопад|грудн|январ|феврал|апрел|июн|июл|август|сентябр|октябр|ноябр|декабр|january|february|march|april|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday|midnight|noon|понеділ|вівтор|серед[ау]|четвер|п['\u2019]ятниц|субот|неділ|понедельник|вторник|сред[ау]|пятниц|суббот|воскресень|щодня|щопонеділ|ежедневно|daily|every\s+day/i,exact:false},
  {q:/скільки|сколько|how\s+(?:much|many|long)|ціна|цена|price|cost|кошту|стоит|вартіст|стоимост/i,re:/\d/,exact:false}
];
function __questionType(q){
  const s=String(q||"");
  for(const t of __QT)if(t.q.test(s))return t;
  return null;
}

/* v5.11.94: малий словник синонімів uk/ru/en для розширення запиту в answer().
   «Скільки коштує?» знаходить «Ціна становить…» навіть без спільних слів. */
const __SYN_GROUPS=[
  ["ціна","ціни","ціну","вартість","вартости","коштує","коштують","коштувати","стоит","стоимость","стоимости","price","prices","cost","costs","pricing"],
  ["телефон","телефону","телефонний","номер","номеру","дзвонити","подзвонити","зателефонувати","телефонувати","звонить","позвонить","phone","call","calling","tel"],
  ["адреса","адресу","адреси","розташований","розташована","розташування","знаходиться","адрес","адресу","расположен","находится","address","located","location"],
  ["коли","когда","when","дата","дати","date"],
  ["хто","кто","who","ім'я","имя","name"],
  ["де","где","where","місце","место","place"],
  ["як","как","how","спосіб","способ","way","method"],
  ["чому","почему","why","причина","причина","reason"],
  ["що","что","what","який","какой","which"],
  ["купити","купить","buy","покупка","покупка","purchase"],
  ["продати","продать","sell","продаж","продажа","sale"],
];
const __SYN=(()=>{
  const m=new Map();
  for(const g of __SYN_GROUPS)for(const w of g)m.set(w,g.filter(x=>x!==w));
  return m;
})();

/* Знайти 2–3 найрелевантніші речення контексту до питання.
   v5.11.76: BM25 (Okapi) замість перекриття з sqrt-нормалізацією.
   v5.11.85: множник покриття запиту (1+matched/qTerms) поверх BM25 —
   речення з більшою часткою унікальних термінів запиту важить більше.
   IDF рахується по реченнях контексту, tf — stemMatch (укр. морфологія),
   довжинна нормалізація k1=1.2/b=0.75. Бюджет часу — частковий результат. */
function answer(question,context,n){
  n=__clampInt(n,3,1,5);
  guardInput(question);guardInput(context);
  const budget=makeBudget();
  /* v5.11.93: tokenizeQA зберігає коди, роки, версії та абревіатури (P0300, 2026, 4.2.1, ШІ, KV),
     які звичайний tokenize викидає — без них питання «Що означає P0420?» не мало жодного терміна. */
  const qBase=[...new Set(tokenizeQA(question))];
  const sentences=splitSentences(context);
  if(!qBase.length||!sentences.length)return[];
  /* Токенізувати речення один раз. */
  const docs=[];
  let totalLen=0;
  for(let i=0;i<sentences.length;i++){
    try{budget.check();}catch(e){break;}
    const toks=tokenizeQA(sentences[i]);
    docs.push({s:sentences[i],toks});
    totalLen+=toks.length;
  }
  if(!docs.length)return[];
  /* v5.11.94: розширення запиту синонімами — лише для термінів БЕЗ збігів.
     «коштує» знаходить «ціна», але не розбавляє вагу термінів, що вже збігаються. */
  const qTokens=[...new Set(qBase.flatMap(t=>{
    const hasMatch=docs.some(d=>d.toks.some(w=>stemMatch(t,w)));
    return hasMatch?[t]:[t,...(__SYN.get(t)||[])];
  }))];
  const N=docs.length,avgdl=Math.max(1,totalLen/N),k1=1.2,b=0.75;
  /* IDF по реченнях: термін враховується, якщо хоч один токен stemMatch-иться. */
  const idf=qTokens.map(q=>{
    let df=0;
    for(const d of docs){
      if(d.toks.some(w=>stemMatch(q,w)))df++;
    }
    return df?Math.log((N-df+0.5)/(df+0.5)+1):0;
  });
  const qType=__questionType(question);
  const scored=[];
  for(let i=0;i<docs.length;i++){
    try{budget.check();}catch(e){break;} /* час вичерпано — частковий результат */
    const d=docs[i];
    if(!d.toks.length)continue;
    let score=0,matched=0;
    for(let qi=0;qi<qTokens.length;qi++){
      if(!idf[qi])continue;
      let tf=0;
      for(const w of d.toks)if(stemMatch(qTokens[qi],w))tf++;
      if(!tf)continue;
      matched++;
      const norm=1-b+b*(d.toks.length/avgdl);
      score+=idf[qi]*(tf*(k1+1))/(tf+k1*norm);
    }
    if(score>0){
      /* v5.11.85: бонус покриття запиту. Класична слабкість чистого BM25 —
         один рідкісний термін з високим tf перебиває речення, що містить
         усі терміни запиту (див. CXM25 U-компонент, analytix RAG
         «the more hit tokens, the slight coverage bonus»). */
      score*=1+matched/qTokens.length;
      /* v5.11.93: тип очікуваної відповіді — речення з датою/часом для «коли», з числом для
         «скільки», з номером чи адресою пошти для «телефон»/«email» важить трохи більше. */
      if(qType&&qType.re.test(d.s))score*=1.3;
      scored.push({i,s:d.s,score});
    }else if(qType&&qType.exact&&qType.re.test(d.s)){
      /* жодного спільного слова («Який телефон?» ↔ «…or call 306-555-0142»), але в реченні є
         саме те, про що питають — слабкий кандидат, щоб не лишити питання без відповіді. */
      scored.push({i,s:d.s,score:0.01});
    }
  }
  return __topDistinct(scored,n);
}
/* v5.11.93: топ-N за оцінкою БЕЗ повторів однакового тексту (у документах із шаблонними
   рядками всі три «відповіді» були одним і тим самим реченням), далі — порядок документа. */
function __topDistinct(scored,n){
  scored.sort((a,b)=>b.score-a.score||a.i-b.i);
  const seen=new Set(),top=[];
  for(const x of scored){
    const key=x.s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();
    if(seen.has(key))continue;
    seen.add(key);top.push(x);
    if(top.length>=n)break;
  }
  return top.sort((a,b)=>a.i-b.i).map(x=>x.s);
}

/* Збалансований бюджет резюме по позиціях (head/middle/tail ≈33/34/33, за зразком
   «Weighted Summaries» для боротьби з lead-bias у довгих документах):
   береться top-1 речення кожного чанка, у підсумкове резюме йдуть
   [перший, середній, останній] — початок, середина і висновок документа.
   При ≤3 чанках результат ідентичний старій поведінці (перші 3 чанки).
   Чиста функція, детермінована, без побічних ефектів. */
function composeBudgetedSummary(tops){
  if(!Array.isArray(tops))return[];
  if(tops.length<=3)return tops.slice();
  const mid=Math.floor(tops.length/2);
  return [tops[0],tops[mid],tops[tops.length-1]];
}

/* v5.11.93: межі частин великого тексту для analyze(): ~100 000 символів кожна, але розріз
   — на межі рядка або слова, а не посеред слова (обрізки потрапляли в ключові слова й двічі
   рахувались у статистиці). Повертає [[from,to],…]; для тексту ≤100k — одна частина. */
function analyzeChunkRanges(text){
  const t=String(text==null?"":text),CHUNK=100000,out=[];
  for(let s=0;s<t.length;){
    let end=Math.min(t.length,s+CHUNK);
    if(end<t.length){
      const nl=t.lastIndexOf("\n",end),sp=t.lastIndexOf(" ",end);
      const cut=nl>s+CHUNK*0.8?nl:(sp>s+CHUNK*0.8?sp:-1);
      if(cut>s)end=cut+1;
    }
    out.push([s,end]);
    s=end;
  }
  return out;
}

/* Комбінований звіт.
   v5.11.75: великі тексти (>100k символів) — по частинах, з прапорцем partial.
   v5.11.91: summaryPool — top-1 кожного чанка → composeBudgetedSummary
   (head/middle/tail), висновок більше не губиться.
   v5.11.96: чанк аналізується ОДНИМ проходом (__analyzeChunk) — один splitSentences
   і один tokenize на чанк замість 2×/3× (прийом за зразком wink-nlp: токенізувати
   один раз у спільну колекцію, далі всі стадії — статистика, частоти, скоринг
   речень — працюють на ній). Результат побайтово ідентичний старому циклу. */
function analyze(text){
  const t=guardInput(text);
  const CHUNK=100000;
  if(t.length<=CHUNK){
    return{
      lang:detectLang(t),
      stats:stats(t),
      keywords:keywords(t,10),
      summary:summarize(t,3),
      partial:false,
      truncated:false
    };
  }
  const budget=makeBudget();
  const lang=detectLang(t.slice(0,10000));
  const agg={chars:0,words:0,sentences:0,uniq:new Set(),sLenW:0,sLenN:0,wLenW:0,wLenN:0,complexity:0};
  const freq=new Map();
  const perChunkTop=[];
  let partial=false;
  let truncated=false;
  for(const [from,to] of analyzeChunkRanges(t)){
    try{budget.check();}catch(e){partial=true;truncated=true;break;}
    const chunk=t.slice(from,to);
    const ca=__analyzeChunk(chunk); /* v5.11.96: один прохід замість stats+tokenize+summarize */
    const st=ca.stats;
    agg.chars+=st.chars;agg.words+=st.words;agg.sentences+=st.sentences;
    agg.sLenW+=st.avgSentenceLen*st.sentences;agg.sLenN+=st.sentences;
    agg.wLenW+=st.avgWordLen*st.words;agg.wLenN+=st.words;
    if(st.complexity>agg.complexity)agg.complexity=st.complexity;
    for(const [w,c] of ca.freq){freq.set(w,(freq.get(w)||0)+c);agg.uniq.add(w);}
    if(ca.top)perChunkTop.push(ca.top);
  }
  const topKeywords=__groupWordForms([...freq.entries()]
    .sort((a,b)=>b[1]-a[1]||(a[0]<b[0]?-1:1)))
    .slice(0,10).map(([word,count])=>({word,count}));
  const summaryPool=composeBudgetedSummary(perChunkTop);
  return{
    lang,
    stats:{
      chars:agg.chars,words:agg.words,sentences:agg.sentences,
      avgSentenceLen:agg.sLenN?+((agg.sLenW/agg.sLenN).toFixed(1)):0,
      avgWordLen:agg.wLenN?+((agg.wLenW/agg.wLenN).toFixed(1)):0,
      uniqueWords:agg.uniq.size,complexity:agg.complexity
    },
    keywords:topKeywords,
    summary:summaryPool,
    partial:true,        /* сумісність: «оброблено частинами» */
    truncated            /* v5.11.93: true лише коли бюджет часу вичерпано і текст оброблено НЕ весь */
  };
}


/* Аналіз одного чанка ОДНИМ проходом (внутрішня, v5.11.96).
   Старий цикл analyze() викликав на кожен чанк: stats(chunk) [splitSentences +
   tokenize], tokenize(chunk) [частоти/uniq] і summarize(chunk,1) [splitSentences +
   tokenize + tokenize по реченнях] — разом 2× splitSentences і 3× tokenize.
   Тут: один splitSentences + один tokenize, далі статистика, карта частот і
   top-1 речення рахуються з тих самих масивів за тими самими формулами, що
   stats()/wordFreq()/summarize(,1) — результат побайтово ідентичний.
   Повертає {stats, freq, top}: stats — як stats(chunk), freq — Map як
   wordFreq(tokenize(chunk)), top — top-1 речення або null. */
function __analyzeChunk(chunk){
  const budget=makeBudget();
  const sentences=splitSentences(chunk);
  const tokens=tokenize(chunk);
  /* stats(chunk) — ті самі формули, той самий порядок обчислень. */
  const rawWords=chunk.trim()?chunk.trim().split(/\s+/).length:0;
  const avgSent=sentences.length?(tokens.length/sentences.length):0;
  const avgWord=tokens.length?(tokens.reduce((a,w)=>a+w.length,0)/tokens.length):0;
  const unique=new Set(tokens).size;
  const complexity=Math.min(100,Math.round(avgSent*2.2+avgWord*4+(tokens.length?Math.max(0,(1-unique/tokens.length))*30:0)));
  const st={
    chars:chunk.length,
    words:rawWords,
    sentences:sentences.length,
    avgSentenceLen:+(sentences.length?rawWords/sentences.length:0).toFixed(1),
    avgWordLen:+avgWord.toFixed(1),
    uniqueWords:unique,
    complexity
  };
  /* wordFreq(tokenize(chunk)) — та сама карта частот для ключових слів і скорингу. */
  const freq=new Map();
  for(const w of tokens)freq.set(w,(freq.get(w)||0)+1);
  /* summarize(chunk,1) — той самий скоринг на тих самих sentences/freq. */
  let top=null;
  if(sentences.length===1)top=sentences[0];
  else if(sentences.length>1){
    const total=sentences.length,scored=[];
    for(let i=0;i<sentences.length;i++){
      try{budget.check();}catch(e){break;} /* час вичерпано — частковий результат */
      const s=sentences[i];
      const toks=tokenize(s);
      if(!toks.length)continue;
      const freqSum=toks.reduce((a,w)=>a+(freq.get(w)||0),0)/toks.length;
      const posBonus=leadBiasPos(i,total);
      /* Штраф за надто короткі/довгі речення. */
      const lenPenalty=toks.length<3?0.15:(toks.length<4?0.4:(toks.length>40?0.7:1.0));
      const score=freqSum*posBonus*lenPenalty;
      if(score>0)scored.push({i,s,score});
    }
    const r=__topDistinct(scored,1);
    if(r.length)top=r[0];
  }
  return{stats:st,freq,top};
}

/* ============ 39 модулів покращення (команда з 40 агентів) ============ */
/* --- #1: splitSentencesSmart --- */
const __imp1=(function(){var module={exports:{}};
/* BridgeCore improvement #1 — розумна токенізація речень.
   Проблема базового splitSentences: розриває речення після скорочень
   (т.д., напр., Mr., e.g. …), всередині чисел (3.14), URL та email.
   Рішення: тимчасово «захистити» небезпечні фрагменти (плейсхолдери
   та заміна крапки всередині скорочень на \u0001), розбити лише на
   справжніх межах, потім відновити оригінали. Чистий JS, zero deps. */

/* Словник скорочень: українські, російські, англійські.
   Одно літерні "р.", "м.", "д.", "п.", "с." навмисно НЕ включено —
   вони часто завершують справжнє речення ("у 1990 р. Він ..."). */
const ABBR = [
  /* українські / російські (багатолітерні та з кількома крапками) */
  "т.д.", "т.п.", "т.ч.", "т.зв.", "в.т.ч.", "напр.", "прим.",
  "вул.", "ім.", "проф.", "див.", "рис.", "табл.", "стор.",
  "обл.", "буд.", "кв.", "тов.", "гр.", "доц.", "канд.", "акад.",
  "ін.", "д-р", "наук.",
  /* англійські */
  "mr.", "mrs.", "ms.", "dr.", "st.", "e.g.", "i.e.", "vs.",
  "etc.", "no.", "fig.", "tab.", "chap.", "sec.", "vol.", "ed.",
  "approx.", "dept.", "est.", "jr.", "sr.", "ph.d.", "m.d.",
  "a.m.", "p.m.", "u.s.", "u.k.", "u.s.a."
];

/* Екранування крапок і сортування за довжиною спадання:
   довші скорочення ("т.зв.") мають збігатися раніше за коротші. */
function esc(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
const ABBR_SORTED = ABBR.slice().sort((a, b) => b.length - a.length);
const ABBR_RE = new RegExp(
  "(^|[\\s(\\[{\"\u201c\u00ab'\u2019-])(" + ABBR_SORTED.map(esc).join("|") + ")",
  "giu"
);

/* URL / email: https://..., www..., name@host.tld */
/* v5.11.93: локальна частина email обмежена 64 символами і мусить починатися на межі —
   без цього рядок із 60 000 літер без «@» розбирався 66 секунд (O(n²)). */
const URL_EMAIL_RE = /https?:\/\/[^\s"“”«»<>]+|www\.[^\s"“”«»<>]+|(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]{1,64}@[\p{L}\p{N}.-]{1,255}\.[\p{L}]{2,}/giu;
/* Числа з крапкою: 3.14, 1.0, 192.168 */
const NUMBER_RE = /\d+\.\d+/g;

/* Захищена крапка (всередині скорочень) та маркер плейсхолдера. */
const DOT = "\u0001";
const PH = "\u0000";

/* Розбити текст на речення, не рвучи скорочень, чисел, URL та email.
   Вхід null/undefined/"" → []. Порядок збережено, trim, порожні відфільтровано. */
function splitSentencesSmart(text) {
  let src = String(text || "");
  if (src.length > 500000) src = src.slice(0, 500000); /* v5.11.93: той самий ліміт, що й у ядра */
  src = src.replace(/\s+/g, " ").trim();
  if (!src) return [];

  /* Крок 1: заховати URL, email і числа з крапкою за плейсхолдери. */
  const kept = [];
  const hide = (m) => { kept.push(m); return PH + "K" + (kept.length - 1) + PH; };
  let t = src.replace(URL_EMAIL_RE, hide).replace(NUMBER_RE, hide);

  /* Крок 2: у скороченнях замінити "." на захищену крапку. */
  t = t.replace(ABBR_RE, (m, pre, abbr) => pre + abbr.replace(/\./g, DOT));

  /* Крок 3: розбити на справжніх межах — після . ! ? … перед пробілом
     і великою літерою, цифрою чи відкривальною лапкою/дужкою. */
  /* v5.11.93: lookbehind без «+» (рівнозначно, але лінійно на довгих серіях крапок). */
  const parts = t.split(/(?<=[.!?…])\s+(?=[А-ЯA-ZІЇЄҐЁ0-9"“«(\[{])/u);

  /* Крок 4: відновити захищені фрагменти. */
  const phRe = new RegExp(PH + "K(\\d+)" + PH, "g");
  const dotRe = new RegExp(DOT, "g");
  const restore = (s) =>
    s.replace(phRe, (m, i) => kept[+i]).replace(dotRe, ".");

  return parts.map((s) => restore(s).trim()).filter((s) => s.length > 1);
}

module.exports = {
  name: "1-sentence-split-smart",
  description: "Розумне розбиття тексту на речення: не розриває після скорочень (т.д., напр., Mr., e.g. …), всередині чисел (3.14), URL та email.",
  functions: { splitSentencesSmart }
};

return module.exports;})();
/* --- #2: STOP_UK_EXTENDED, isStopUK --- */
const __imp2=(function(){var module={exports:{}};
/* Improvement 2 — Розширені українські стоп-слова (200+).
   Чистий JS, zero dependencies, без мережевих викликів.
   Категорії: займенники, прийменники, сполучники, частки,
   дієслова-зв'язки, прислівники-заповнювачі, числівники. */
"use strict";

/* Розширений набір українських стоп-слів (включає весь базовий набір STOP з core.js v5.11.70). */
const STOP_UK_EXTENDED = new Set((
  /* --- Займенники (особові, присвійні, вказівні, питальні, заперечні, неозначені) --- */
  "я,мене,мені,мною," +
  "ти,тебе,тобі,тобою," +
  "він,нього,йому,ним," +
  "вона,неї,їй,нею," +
  "воно," +
  "ми,нас,нам,нами," +
  "ви,вас,вам,вами," +
  "вони,них,ними," +
  "себе,собі,собою," +
  "його,її,їх," +
  "мій,моя,моє,мої," +
  "твій,твоя,твоє,твої,твого," +
  "свій,своя,своє,свої," +
  "наш,наша,наше,наші," +
  "ваш,ваша,ваше,ваші," +
  "той,та,те,ті,того,цій,цих,цими,цією," +
  "цей,ця,ці,цю," +
  "оцей,оця,оце," +
  "такий,така,таке,такі," +
  "який,яка,які,яку,яких,якими," +
  "котрий,котра,котре,котрі," +
  "чий,чия," +
  "весь,вся,все,всі,всіх,усього," +
  "хто,чого,кого,кому," +
  "що,як,то,це," +
  "ніхто,ніщо,нічий,жоден,жодна,жодне," +
  "кожен,кожна,кожне,кожну," +
  "інший,інша,інше,інші,інших," +
  "сам,сама,саме,самі," +
  /* --- Прийменники --- */
  "в,во,у,на,під,над,перед,між,через,без,для,до,від," +
  "з,із,зі,с," +
  "о,об,обо,при,про,по,за," +
  "поза,понад,попід,поміж,крім,окрім,замість,попри," +
  "внаслідок,унаслідок,щодо,стосовно,проти,усупереч," +
  "навколо,навпроти,поруч,посеред,мимо,уздовж,обабіч," +
  /* --- Сполучники --- */
  "і,й,та,але,а,чи,бо,щоб,якщо,коли," +
  "ніби,нібито,мовби,наче,немов,начебто," +
  "або,проте,однак,зате,адже,оскільки,позаяк," +
  "тобто,отже,теж,хоч,хоча,доки,поки,тим," +
  /* --- Частки --- */
  "же,ж,би,б,не,ні,лише,тільки,навіть,аж,хай,нехай," +
  "таки,невже,хіба,мов,буцім,лиш,майже," +
  /* --- Дієслова-зв'язки та модальні --- */
  "є,був,була,було,були,буде,будуть,бути," +
  "можна,треба,нема,немає,слід,варто," +
  /* --- Прислівники-заповнювачі --- */
  "дуже,вже,ще,також,так,ось,от,он,там,тут," +
  "сюди,туди,тоді,зараз,завжди,іноді,ніколи," +
  "десь,кудись,якось,чомусь,надто,досить," +
  "мало,багато,трохи,ледь,близько,потім,наразі,нині," +
  /* --- Числівники --- */
  "один,два,три,чотири,п'ять,шість,сім,вісім,дев'ять,десять," +
  "перший,другий,третій,четвертий,п'ятий,шостий,сьомий,восьмий,дев'ятий,десятий," +
  "сто,тисяча,мільйон"
).split(",").map(w => w.trim()).filter(w => w.length > 0));

/* Перевірка: чи є слово українським стоп-словом (регістр ігнорується, trim). */
function isStopUK(word) {
  if (word === null || word === undefined) return false;
  const w = String(word).trim().toLowerCase();
  if (!w) return false;
  return STOP_UK_EXTENDED.has(w);
}

/* Node (тести) + браузер. */
const improvement = {
  name: "2-uk-stopwords-extended",
  description: "Розширені українські стоп-слова (200+): займенники, прийменники, сполучники, частки, дієслова-зв'язки, прислівники-заповнювачі, числівники; isStopUK(word) → bool.",
  functions: { STOP_UK_EXTENDED, isStopUK }
};

if (typeof module !== "undefined" && module.exports) module.exports = improvement;
if (typeof window !== "undefined") window.Improvement2 = improvement;

return module.exports;})();
/* --- #3: STOP_EN_EXTENDED, STOP_RU_EXTENDED, isStopEN, isStopRU --- */
const __imp3=(function(){var module={exports:{}};
/* Агент 3 — розширені англійські та російські стоп-слова.
   Самодостатній CommonJS-модуль: чистий JS, zero dependencies, без мережі.
   en: базовий набір з BridgeCore + додаткові дієслова, модальні, прислівники,
       займенники, прийменники, сполучники.
   ru: базовий набір з BridgeCore + займенники, прийменники, сполучники,
       частки, зв'язки — повний набір. */
"use strict";

/* Базовий en-набір (копія з core.js) — далі розширюємо. */
const EN_BASE = "the,a,an,and,or,but,if,then,else,when,at,by,for,with,about,into,through,during,before,after,above,below,to,from,up,down,in,out,on,off,over,under,again,further,once,here,there,all,any,both,each,few,more,most,other,some,such,no,nor,not,only,own,same,so,than,too,very,can,will,just,should,now,is,are,was,were,be,been,being,have,has,had,having,do,does,did,doing,would,could,ought,i,you,he,she,it,we,they,them,their,this,that,these,those,am,as,of,its,my,your,his,her,our";

/* Розширення en: модальні, допоміжні та додаткові дієслова (+форми),
   прислівники, займенники, прийменники, сполучники. */
const EN_EXTRA = "shall,may,might,must,dare," +
  "me,him,us,myself,yourself,yourselves,ourselves,himself,herself,itself,themselves," +
  "mine,yours,theirs,ours,hers,ones," +
  "who,whom,whose,what,whatever,which,whichever,where,wherever,why,how," +
  "somebody,someone,something,anybody,anyone,anything,everybody,everyone,everything,nobody,none,either,neither,many,much,little,less,least,several,various,another," +
  "get,gets,got,getting,make,makes,made,making,take,takes,took,taken,taking," +
  "come,comes,came,coming,go,goes,going,gone,went,say,says,said,saying," +
  "know,knows,knew,known,knowing,like,likes,liked,want,wants,wanted,wanting," +
  "need,needs,needed,needing,see,sees,saw,seen,seeing,give,gives,gave,given,giving," +
  "put,puts,putting,use,uses,used,using,find,finds,found,finding," +
  "think,thinks,thought,thinking,seem,seems,seemed,seeming," +
  "become,becomes,became,becoming,try,tries,tried,trying," +
  "leave,leaves,left,leaving,keep,keeps,kept,keeping,let,lets,letting," +
  "show,shows,showed,shown,showing,tell,tells,told,telling,ask,asks,asked,asking," +
  "call,calls,called,calling,run,runs,ran,running,set,sets,setting," +
  "mean,means,meant,meaning,help,helps,helped,helping,turn,turns,turned,turning," +
  "start,starts,started,starting,move,moves,moved,moving,work,works,worked,working," +
  "feel,feels,felt,feeling," +
  "already,yet,still,even,ever,never,always,also,often,usually,sometimes,rarely,seldom," +
  "quite,rather,almost,nearly,enough,perhaps,maybe,really,soon,later," +
  "today,yesterday,tomorrow,meanwhile,however,therefore,thus,hence,anyway,otherwise,instead,indeed," +
  "without,within,across,among,between,behind,beyond,along,amongst,per,via,because," +
  "despite,except,until,till,upon,near,around,aside,ago,onto,past,versus";

const STOP_EN_EXTENDED = new Set((EN_BASE + "," + EN_EXTRA).split(",").map(w => w.trim()).filter(Boolean));

/* Базовий ru-набір (копія з core.js) — далі розширюємо. */
const RU_BASE = "а,но,или,если,то,тогда,так,также,вот,вон,это,эта,эти,этот,к,ко,в,во,на,над,под,о,об,от,до,для,при,без,через,между,из,у,с,со,не,ни,нет,да,же,ж,ли,бы,б,ведь,вон,там,тут,здесь,как,какой,какая,какие,который,которая,которые,что,чтобы,кто,меня,мне,мы,нас,вы,вас,он,она,они,его,ее,их,тебя,себя,мой,моя,мое,мои,твой,твоя,свой,своя,наш,ваш,весь,вся,все,каждый,другой,сам,сама,уже,еще,только,лишь,даже,очень,более,менее,можно,нужно,есть,быть,был,была,были,было,будет,будут,него,нее,когда,или";

/* Розширення ru: займенники (+відмінкові форми), прийменники, сполучники,
   частки, зв'язки, прислівники, вказівні й кількісні слова. */
const RU_EXTRA = "я,ты,тебе,ей,ему,них,ним,ними,нами,вами,мной,тобой,собой,мною,тобою," +
  "моего,моей,моему,моим,моими,моем,твоего,твоей,твоему,твоим,твоими,твоем," +
  "свое,своих,своем,своими,свою,наша,наше,наши,нашего,нашей,нашим," +
  "ваша,ваше,ваши,вашего,вашей,вашим," +
  "за,про,обо,вдоль,около,возле,вокруг,рядом,мимо,после,перед,среди,помимо,поверх,кроме," +
  "внутри,вне,внутрь,вместо,вследствие,вроде,навстречу,согласно,вопреки,благодаря," +
  "из-за,из-под,вверх,вниз,назад,вперед,напротив,сквозь," +
  "и,ибо,либо,тоже,однако,зато,притом,причем,поскольку,потому,поэтому,оттого," +
  "хотя,хоть,пусть,пускай,дабы,коли,пока,едва,значит,следовательно,итак," +
  "мол,дескать,де,именно,просто,уж,никак,всего,навсего,почти," +
  "является,являются,стал,стала,стали,становится,становиться,кажется,оказалось,получается," +
  "потом,затем,сначала,сейчас,теперь,всегда,никогда,иногда,часто,редко,обычно,снова,опять," +
  "вместе,наоборот,наверное,вероятно,может,должен,должна,должны,должно,надо,нельзя,пора,жаль," +
  "столько,сколько,несколько,много,мало,больше,меньше,самый,самая,самое,самые," +
  "почему,зачем,откуда,куда,где,каков,чей,чья,чье,чьи," +
  "каждая,каждое,каждые,всякий,всякая,любой,любая,иной,иная,некоторый,некоторые," +
  "такой,такая,такие,такое,таков," +
  "этого,этой,этом,этими,тот,того,той,тому,тем,те,тех,теми," +
  "никто,ничто,ничего,ничем,нисколько";

const STOP_RU_EXTENDED = new Set((RU_BASE + "," + RU_EXTRA).split(",").map(w => w.trim()).filter(Boolean));

/* Перевірка: чи є слово англійським стоп-словом (регістр неважливий). */
function isStopEN(word) {
  if (typeof word !== "string" || !word) return false;
  return STOP_EN_EXTENDED.has(word.toLowerCase());
}

/* Перевірка: чи є слово російським стоп-словом (регістр неважливий). */
function isStopRU(word) {
  if (typeof word !== "string" || !word) return false;
  return STOP_RU_EXTENDED.has(word.toLowerCase());
}

module.exports = {
  name: "3-extended-stopwords-en-ru",
  description: "Розширені набори стоп-слів: англійські 150+ (модальні, дієслова, прислівники) і російські 150+ (займенники, прийменники, сполучники, частки, зв'язки) плюс функції перевірки isStopEN/isStopRU.",
  functions: { STOP_EN_EXTENDED, STOP_RU_EXTENDED, isStopEN, isStopRU }
};

return module.exports;})();
/* --- #4: stemUK, stemPair --- */
const __imp4=(function(){var module={exports:{}};
/* improvement_4 — український стеммінг простими правилами суфіксів (агент 4).
   Заміна грубого stemMatch (спільний префікс ≥5) на морфологічне відрізання
   українських закінчень. Чистий JS, zero dependencies, самодостатній —
   не залежить від BridgeCore. */
"use strict";

/* Суфікси строго від найдовших до найкоротших (порядок важливий:
   «читання» має дати «чит» через -ання, а не «чита» через -ння). */
const SUFFIXES = [
  "ннями",                                  /* 5 */
  "істю","ість","ення","ання","яння","іння","ття","ння", /* 4 */
  "ого","ього","ому","ьому","ами","ями","ими","іми",
  "вши","учи","ючи","ати","ити","еть","ать","ять",
  "ах","ях","ів","ій","ої",                /* 3 */
  "ють",                                  /* 3 — 3 ос. мн. дієслів: витягують→витяг */
  "ши","тя",                              /* 2 — -тя: життя→жит */
  "у","ю","а","я","о","е","и","і","ї"       /* 1 */
];

/* Однолітерні голосні закінчення — для коротких слів (< 5 символів):
   «мрії»→«мрі», але «кіт» лишається «кіт». */
const SHORT_SUFFIXES = ["у","ю","а","я","о","е","и","і","ї"];

/* Мінімальна довжина основи. */
const MIN_STEM = 3;

/* stemUK(word) → основа слова, нижній регістр.
   - порожній вхід / null → ""
   - слова коротші 5 символів: лише однолітерні голосні закінчення
   - відрізання ітеративне (напр. «витягують» → -ю → -у → «витяг»),
     зупинка коли основа коротша за 3 або суфікс не збігається */
function stemUK(word){
  if(word === null || word === undefined) return "";
  let w = String(word).toLowerCase();
  if(!w) return "";
  const list = w.length < 5 ? SHORT_SUFFIXES : SUFFIXES;
  let changed = true;
  while(changed){
    changed = false;
    for(const s of list){
      if(w.length - s.length >= MIN_STEM && w.endsWith(s)){
        w = w.slice(0, -s.length);
        changed = true;
        break;
      }
    }
  }
  return w;
}

/* stemPair(a,b) — точніша заміна базового stemMatch: слова вважаються
   спорідненими, якщо їхні основи збігаються («плани»/«планів», «мрії»/«мрія»). */
function stemPair(a, b){
  if(a === null || a === undefined || b === null || b === undefined) return false;
  const x = stemUK(a), y = stemUK(b);
  return x.length >= MIN_STEM && x === y;
}

module.exports = {
  name: "4-uk-stemming",
  description: "Український стеммінг простими правилами суфіксів: stemUK ітеративно відрізає укр. закінчення (основа ≥3, нижній регістр), stemPair порівнює слова за основою точніше за базовий stemMatch.",
  functions: { stemUK, stemPair }
};

return module.exports;})();
/* --- #5: normalizeText --- */
const __imp5=(function(){var module={exports:{}};
/* BridgeCore improvement #5: нормалізація тексту.
   normalizeText(text) -> string:
   - Unicode NFC;
   - HTML-теги: блочні (<p>, <div>, <h1>..) -> межа абзацу,
     рядкові (<br>, <li>) -> одинарний перенос, решта -> пробіл;
   - Markdown: заголовки #, жирний/курсив (зірочки й підкреслення),
     посилання [t](url) -> t, інлайн-код `код` -> код,
     горизонтальні лінії ---, маркери списків -, цитати >;
   - множинні пробіли -> один, множинні переноси -> один, trim;
   - структура абзаців зберігається: подвійний перенос -> одинарний маркер (\n).
   Чистий JS, zero dependencies. */
"use strict";

function normalizeText(text) {
  // Безпечний вхід: null/undefined/не-рядок → "".
  let t = String(text == null ? "" : text);

  // 1. Unicode NFC.
  t = t.normalize("NFC");

  // 2. HTML: блочні теги -> межа абзацу (\n\n), <br>/<li> -> одинарний перенос,
  //    решта тегів -> пробіл. Коментарі/скрипти/стилі прибираємо цілком.
  t = t
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\s*(br|hr)\s*\/?\s*>/gi, "\n")
    .replace(/<\s*(li|tr)(\s[^>]*)?>/gi, "\n")
    .replace(/<\s*\/(li|tr|td|th)\s*>/gi, "\n")
    .replace(/<\s*\/?(p|div|h[1-6]|ul|ol|blockquote|section|article|header|footer|table|tbody|thead|tfoot)(\s[^>]*)?>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ");

  // 3. Markdown.
  //    Посилання з картинками: ![alt](url) → alt; [текст](url) → текст.
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  //    Інлайн-код: `код` → код (до видалення інших маркерів).
  t = t.replace(/`([^`]+)`/g, "$1");
  //    Заголовки на початку рядка: # Текст → Текст.
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  //    Горизонтальні лінії: рядок з --- / *** / ___ → прибрати.
  t = t.replace(/^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/gm, "");
  //    Жирний/курсив: **текст**, __текст__, *текст*, _текст_ → текст.
  t = t.replace(/\*\*([^*]+)\*\*/g, "$1");
  t = t.replace(/__([^_]+)__/g, "$1");
  t = t.replace(/(^|\s)\*([^*\s][^*]*)\*(?=\s|$|[.,;:!?])/g, "$1$2");
  t = t.replace(/(^|\s)_([^_\s][^_]*)_(?=\s|$|[.,;:!?])/g, "$1$2");
  //    Маркери списків: "- пункт" / "* пункт" → "пункт" (рядок залишається).
  t = t.replace(/^\s{0,3}[-*]\s+/gm, "");
  //    Цитати: "> текст" → "текст".
  t = t.replace(/^\s{0,3}>\s?/gm, "");

  // 4. Абзаци: подвійний (і більше) перенос -> одинарний маркер (\n);
  //    одиночні переноси всередині абзацу зберігаються.

  // 5. Множинні пробіли -> один; множинні переноси -> одинарний маркер;
  //    пробіли навколо одиночних переносів прибрати; trim.
  t = t
    .replace(/[ \t\u00A0\u2000-\u200B\u202F\u205F\u3000]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .replace(/ *\n */g, "\n")
    .trim();

  return t;
}

module.exports = {
  name: "5-text-normalization",
  description: "Нормалізація тексту: Unicode NFC, видалення HTML-тегів і Markdown-розмітки, стиснення пробілів зі збереженням структури абзаців.",
  functions: { normalizeText: normalizeText }
};

return module.exports;})();
/* --- #6: summarizeTFIDF, tfidfTerms --- */
const __imp6=(function(){var module={exports:{}};
/* Агент 6 — TF-IDF скоринг речень для екстрактивного резюме.
   Чистий JavaScript, zero dependencies, без мережевих викликів.
   Функції самодостатні: токенізація та розбиття на речення включені. */

/* Скорочений набір стоп-слів uk / en / ru (скопійовано з логіки core.js). */
const STOP = new Set((
  "а,але,бо,був,була,були,було,буде,будуть,в,вас,весь,від,він,вона,вони,воно,все,всіх,ви," +
  "для,до,де,ж,же,з,за,й,його,її,їх,і,із,чи,як,яка,який,які,яку,мене,мені,ми,на,над,нас," +
  "не,немає,ні,о,об,ось,під,по,про,с,свій,своя,свої,так,таки,там,те,ти,то,тобто,тоді," +
  "тільки,у,це,цей,ця,ці,цю,що,щоб,я,йому,тебе,нього,неї,коли,якщо,або,надто,вже,ще," +
  "також,між,через,при,без,кожен,кожна,інший,інша,саме,лише,навіть,дуже,більше,менше," +
  "можна,треба,бути,є,нема,от,он," +
  ",the,a,an,and,or,but,if,then,else,when,at,by,for,with,about,into,through,during," +
  "before,after,above,below,to,from,up,down,in,out,on,off,over,under,again,further,once," +
  "here,there,all,any,both,each,few,more,most,other,some,such,no,nor,not,only,own,same," +
  "so,than,too,very,can,will,just,should,now,is,are,was,were,be,been,being,have,has,had," +
  "having,do,does,did,doing,would,could,ought,i,you,he,she,it,we,they,them,their,this," +
  "that,these,those,am,as,of,its,my,your,his,her,our," +
  ",а,но,или,если,то,тогда,так,также,вот,вон,это,эта,эти,этот,к,ко,на,над,под,о,об,от," +
  "до,для,при,без,через,между,из,у,с,со,ни,нет,да,ли,бы,б,ведь,там,тут,здесь,как,какой," +
  "какая,какие,который,которая,которые,чтобы,кто,меня,мне,мы,нас,вы,вас,он,она,они," +
  "его,ее,их,тебя,себя,мой,моя,мое,мои,твой,твоя,свой,своя,наш,ваш,весь,вся,каждый," +
  "другой,сам,сама,уже,еще,лишь,даже,очень,более,менее,можно,нужно,есть,быть,был," +
  "была,были,было,будет,будут,него,нее,когда"
).split(","));

/* Розбиття тексту на речення (власний хелпер, за логікою core.js). */
function _splitSentences(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?…])\s+(?=[А-ЯA-ZІЇЄҐЁ])/u)
    .map(s => s.trim())
    .filter(s => s.length > 1);
}

/* Токенізація: нижній регістр, літери/цифри (unicode), без стоп-слів,
   довжина > 2, без токенів з цифрами. */
function _tokenize(text) {
  return String(text || "").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .map(w => w.trim())
    .filter(w => w.length > 2 && !STOP.has(w) && !/\d/.test(w));
}

/* TF-IDF оцінка речення:
   TF(w,реч) = частота токена в реченні / довжина речення,
   IDF(w) = log(загальна к-сть речень / к-сть речень зі словом),
   оцінка = сума TF-IDF токенів / sqrt(довжина речення в токенах).
   Повертає топ-N речень у вихідному порядку. */
function summarizeTFIDF(text, maxSentences) {
  maxSentences = Math.max(1, Math.min(10, maxSentences == null ? 3 : maxSentences));
  const sentences = _splitSentences(text);
  if (!sentences.length) return [];
  if (sentences.length <= maxSentences) return sentences.slice();

  const N = sentences.length;
  const tokenLists = sentences.map(s => _tokenize(s));

  /* df(w) — кількість речень, що містять слово. */
  const df = new Map();
  for (const toks of tokenLists) {
    const uniq = new Set(toks);
    for (const w of uniq) df.set(w, (df.get(w) || 0) + 1);
  }
  /* IDF: log(N / df). Слово в кожному реченні → IDF = 0 (інформації нуль). */
  const idf = new Map();
  for (const [w, d] of df) idf.set(w, Math.log(N / d));

  const scored = tokenLists.map((toks, i) => {
    if (!toks.length) return { i, s: sentences[i], score: 0 };
    const tf = new Map();
    for (const w of toks) tf.set(w, (tf.get(w) || 0) + 1);
    let sum = 0;
    for (const [w, c] of tf) {
      sum += (c / toks.length) * (idf.get(w) || 0);
    }
    /* Нормалізація довжиною: не давати дуже довгим реченням
       необґрунтованої переваги за сумою. */
    const score = sum / Math.sqrt(toks.length);
    return { i, s: sentences[i], score };
  }).filter(x => x.score > 0);

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSentences)
    .sort((a, b) => a.i - b.i)
    .map(x => x.s);
}

/* Додатковий хелпер: TF-IDF вага кожного терміна документа (для аналізу). */
function tfidfTerms(text) {
  const sentences = _splitSentences(text);
  if (!sentences.length) return [];
  const N = sentences.length;
  const tokenLists = sentences.map(s => _tokenize(s));
  const df = new Map();
  for (const toks of tokenLists) {
    for (const w of new Set(toks)) df.set(w, (df.get(w) || 0) + 1);
  }
  const totalTokens = tokenLists.reduce((a, t) => a + t.length, 0);
  const tfAll = new Map();
  for (const toks of tokenLists) {
    for (const w of toks) tfAll.set(w, (tfAll.get(w) || 0) + 1);
  }
  const out = [];
  for (const [w, c] of tfAll) {
    const tf = totalTokens ? c / totalTokens : 0;
    const idf = Math.log(N / (df.get(w) || 1));
    out.push({ word: w, tfidf: +(tf * idf).toFixed(6) });
  }
  return out.sort((a, b) => b.tfidf - a.tfidf || a.word.localeCompare(b.word));
}

module.exports = {
  name: "6-tfidf-summarize",
  description: "TF-IDF скоринг речень для екстрактивного резюме: оцінка речень за TF-IDF вагами слів з нормалізацією довжиною; повертає топ-N речень у вихідному порядку.",
  functions: { summarizeTFIDF, tfidfTerms }
};

return module.exports;})();
/* --- #7: scoreSentencePosition, summarizeLeadBias --- */
const __imp7=(function(){var module={exports:{}};
/* AI Bridge Core — Покращення #7: lead bias (вага позиції речення в резюме).
   Журналістський принцип перевернутої піраміди: перші речення несуть головне.
   Самодостатній модуль: власні копії splitSentences / tokenize / wordFreq.
   Чистий JS, zero dependencies, без мережевих викликів. */
"use strict";

/* Стоп-слова uk / en / ru (копія з BridgeCore v5.11.70). */
const STOP=new Set(("а,але,бо,був,була,були,було,буде,будуть,в,вас,весь,від,він,вона,вони,воно,все,всіх,ви,для,до,де,ж,же,з,за,й,його,її,їх,і,із,чи,як,яка,який,які,яку,мене,мені,ми,на,над,нас,не,немає,ні,о,об,ось,під,по,про,с,свій,своя,свої,так,таки,там,те,ти,то,тобто,тоді,тільки,у,це,цей,ця,ці,цю,що,щоб,я,йому,тебе,нього,неї,коли,якщо,або,надто,вже,ще,також,між,через,при,без,кожен,кожна,інший,інша,саме,лише,навіть,дуже,більше,менше,можна,треба,будуть,бути,є,нема,от,он,ось"+
",the,a,an,and,or,but,if,then,else,when,at,by,for,with,about,into,through,during,before,after,above,below,to,from,up,down,in,out,on,off,over,under,again,further,once,here,there,all,any,both,each,few,more,most,other,some,such,no,nor,not,only,own,same,so,than,too,very,can,will,just,should,now,is,are,was,were,be,been,being,have,has,had,having,do,does,did,doing,would,could,ought,i,you,he,she,it,we,they,them,their,this,that,these,those,am,as,of,its,my,your,his,her,our"+
",а,но,или,если,то,тогда,так,также,вот,вон,это,эта,эти,этот,к,ко,в,во,на,над,под,о,об,от,до,для,при,без,через,между,из,у,с,со,не,ни,нет,да,же,ж,ли,бы,б,ведь,вон,там,тут,здесь,как,какой,какая,какие,который,которая,которые,что,чтобы,кто,меня,мне,мы,нас,вы,вас,он,она,они,его,ее,их,тебя,себя,мой,моя,мое,мои,твой,твоя,свой,своя,наш,ваш,весь,вся,все,каждый,другой,сам,сама,уже,еще,только,лишь,даже,очень,более,менее,можно,нужно,есть,быть,был,была,были,было,будет,будут,него,нее,когда,или").split(","));

/* Розбити текст на речення (копія з BridgeCore). */
function splitSentences(text){
  return String(text||"")
    .replace(/\s+/g," ")
    .split(/(?<=[.!?…])\s+(?=[А-ЯA-ZІЇЄҐЁ])/u)
    .map(s=>s.trim())
    .filter(s=>s.length>1);
}

/* Токенізація: літери (unicode), нижній регістр, без стоп-слів і сміття (копія з BridgeCore). */
function tokenize(text){
  return String(text||"").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu," ")
    .split(" ")
    .map(w=>w.trim())
    .filter(w=>w.length>2&&!STOP.has(w)&&!/\d/.test(w));
}

/* Частоти слів (копія з BridgeCore). */
function wordFreq(tokens){
  const m=new Map();
  for(const w of tokens)m.set(w,(m.get(w)||0)+1);
  return m;
}

/* Вага позиції речення i (0-based) серед total речень. Діапазон 0..2.
   - i = 0        → 2.0 (лід: головне за принципом перевернутої піраміди)
   - перші 20%    → 1.5 (i > 0, i / total < 0.2)
   - останнє      → 1.3 (висновок / підсумок)
   - середина     → 1.0; у довгих текстах (total ≥ 8) вага лінійно
                    спадає до 0.7 у глибокій середині
   Позадіапазонні або нечислові входи → нейтральні 1.0 (без винятків). */
function scoreSentencePosition(i,total){
  if(!Number.isFinite(i)||!Number.isFinite(total)||total<=0)return 1.0;
  i=Math.floor(i);
  if(i<0||i>=total)return 1.0;
  if(i===0)return 2.0;
  if(i===total-1)return 1.3;
  if(i/total<0.2)return 1.5;
  if(total<8)return 1.0;
  /* Довгий текст: спад 1.0 → 0.7 від кінця лід-зони до передостаннього речення. */
  const start=Math.ceil(total*0.2);
  const end=total-2;
  if(end<=start)return 1.0;
  const depth=(i-start)/(end-start); /* 0..1 */
  return +(1.0-depth*0.3).toFixed(2);
}

/* Екстрактивне резюме з lead bias.
   Оцінка речення = TF-база × вага позиції, де
   TF-база = середня частота токенів речення у всьому тексті.
   Топ-n за оцінкою; результат — у вихідному порядку речень.
   Порожній / null вхід → []. */
function summarizeLeadBias(text,n){
  n=Math.max(1,Math.min(10,Math.floor(n)||3));
  const sentences=splitSentences(text);
  if(!sentences.length)return[];
  if(sentences.length<=n)return sentences.slice();
  const total=sentences.length;
  const freq=wordFreq(tokenize(text));
  const scored=sentences.map((s,i)=>{
    const toks=tokenize(s);
    if(!toks.length)return{i,s,score:-1};
    const tf=toks.reduce((a,w)=>a+(freq.get(w)||0),0)/toks.length;
    return{i,s,score:tf*scoreSentencePosition(i,total)};
  }).filter(x=>x.score>0);
  return scored.sort((a,b)=>b.score-a.score)
    .slice(0,n)
    .sort((a,b)=>a.i-b.i)
    .map(x=>x.s);
}

module.exports={
  name:"7-lead-bias",
  description:"Lead bias: вага позиції речення при резюмуванні (перевернута піраміда — перші речення несуть головне); резюме = TF-база × вага позиції.",
  functions:{scoreSentencePosition,summarizeLeadBias}
};

return module.exports;})();
/* --- #8: sentenceSimilarity, dedupeSentences --- */
const __imp8=(function(){var module={exports:{}};
/* Покращення №8 — детекція дублікатів речень.
   Самодостатній модуль: власні хелпери токенізації, без залежностей,
   чистий JS, жодних мережевих викликів. Коментарі — українською. */
"use strict";

/* Власний набір стоп-слів (uk / en / ru), короткий практичний. */
const STOP = new Set((
  "а,але,бо,був,була,були,було,буде,будуть,в,вас,весь,від,він,вона,вони,воно," +
  "все,всіх,ви,для,до,де,ж,же,з,за,й,його,її,їх,і,із,чи,як,яка,який,які,яку," +
  "мене,мені,ми,на,над,нас,не,немає,ні,о,об,ось,під,по,про,с,свій,своя,свої," +
  "так,таки,там,те,ти,то,тобто,тоді,тільки,у,це,цей,ця,ці,цю,що,щоб,я,йому," +
  "тебе,нього,неї,коли,якщо,або,надто,вже,ще,також,між,через,при,без,кожен," +
  "кожна,інший,інша,саме,лише,навіть,дуже,більше,менше,можна,треба,бути,є,нема" +
  ",the,a,an,and,or,but,if,then,else,when,at,by,for,with,about,into,through," +
  "during,before,after,above,below,to,from,up,down,in,out,on,off,over,under," +
  "again,further,once,here,there,all,any,both,each,few,more,most,other,some," +
  "such,no,nor,not,only,own,same,so,than,too,very,can,will,just,should,now," +
  "is,are,was,were,be,been,being,have,has,had,having,do,does,did,doing," +
  "would,could,ought,i,you,he,she,it,we,they,them,their,this,that,these," +
  "those,am,as,of,its,my,your,his,her,our" +
  ",но,или,если,тогда,так,также,вот,вон,это,эта,эти,этот,к,ко,во,о,об,от," +
  "для,при,без,через,между,из,у,со,ни,нет,да,ли,бы,ведь,тут,здесь,как," +
  "какой,какая,какие,который,которая,которые,что,чтобы,кто,себя,мой,моя," +
  "твой,твоя,ваш,весь,вся,каждый,другой,сам,сама,уже,еще,лишь,даже,очень," +
  "более,менее,нужно,есть,был,была,были,было,будут,него,нее,когда"
).split(","));

/* Токенізація: нижній регістр, лише літери/цифри (unicode),
   довжина > 2, без стоп-слів і чисел. Повертає масив токенів. */
function tokenize(text) {
  return String(text || "").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .map(w => w.trim())
    .filter(w => w.length > 2 && !STOP.has(w) && !/\d/.test(w));
}

/* Множина токенів речення — для схожості Жаккара. */
function tokenSet(sentence) {
  return new Set(tokenize(sentence));
}

/* Схожість Жаккара множин токенів двох речень.
   Жаккар = |A∩B| / |A∪B|. Повертає число 0..1.
   Обидва порожні → 1 (тотожні), одне порожнє → 0.
   Реєстр не має значення, стоп-слова ігноруються. */
function sentenceSimilarity(a, b) {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (A.size === 0 && B.size === 0) return 1;
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return inter / union;
}

/* Видалити точні дублікати та майже-дублікати (схожість > 0.8).
   Залишає ПЕРШЕ входження кожного речення, порядок збережено.
   Порівняння точних дублікатів — за точним збігом рядків (без
   зайвих пробілів на краях). Нечутливе до null/не-рядків у масиві. */
function dedupeSentences(sentences) {
  if (!Array.isArray(sentences)) return [];
  const kept = [];          // рядки, що лишилися
  const keptSets = [];      // їхні множини токенів (для схожості)
  const seenExact = new Set(); // нормалізовані рядки для точних дублів
  for (const s of sentences) {
    if (typeof s !== "string") continue;
    const norm = s.trim();
    if (seenExact.has(norm)) continue; // точний дублікат
    const set = tokenSet(s);
    let isNearDup = false;
    for (const prevSet of keptSets) {
      let inter = 0;
      if (prevSet.size > 0 && set.size > 0) {
        for (const t of set) if (prevSet.has(t)) inter++;
        const union = prevSet.size + set.size - inter;
        if (inter / union > 0.8) { isNearDup = true; break; }
      } else if (prevSet.size === 0 && set.size === 0) {
        isNearDup = true; break; // обидва порожні — тотожні
      }
    }
    if (isNearDup) continue; // майже-дублікат, перше вже збережено
    seenExact.add(norm);
    kept.push(s);
    keptSets.push(set);
  }
  return kept;
}

module.exports = {
  name: "8-dedupe-sentences",
  description: "Детекція дублікатів речень: схожість Жаккара множин токенів і видалення точних та майже-дублікатів із збереженням першого входження й порядку.",
  functions: { sentenceSimilarity, dedupeSentences }
};

return module.exports;})();
/* --- #9: splitByHeadings, summarizeStructured --- */
const __imp9=(function(){var module={exports:{}};
/* AI Bridge Core — improvement 9: резюме зі збереженням структури.
   Самодостатній CommonJS-модуль, zero dependencies, без мережевих викликів.
   - splitByHeadings(text): розбиває текст на розділи за заголовками
     (Markdown #, КАПС-рядки, короткі рядки перед порожнім рядком).
   - summarizeStructured(text, n): екстрактивне резюме — n речень
     під кожним заголовком (TF-скоринг усередині розділу).
   Порожній/null-вхід → порожній масив, винятків немає. */
"use strict";

/* Стоп-слова uk/en/ru (копія з BridgeCore v5.11.70 для самодостатності). */
const STOP=new Set(("а,але,бо,був,була,були,було,буде,будуть,в,вас,весь,від,він,вона,вони,воно,все,всіх,ви,для,до,де,ж,же,з,за,й,його,її,їх,і,із,чи,як,яка,який,які,яку,мене,мені,ми,на,над,нас,не,немає,ні,о,об,ось,під,по,про,с,свій,своя,свої,так,таки,там,те,ти,то,тобто,тоді,тільки,у,це,цей,ця,ці,цю,що,щоб,я,йому,тебе,нього,неї,коли,якщо,або,надто,вже,ще,також,між,через,при,без,кожен,кожна,інший,інша,саме,лише,навіть,дуже,більше,менше,можна,треба,будуть,бути,є,нема,от,он,ось"+
",the,a,an,and,or,but,if,then,else,when,at,by,for,with,about,into,through,during,before,after,above,below,to,from,up,down,in,out,on,off,over,under,again,further,once,here,there,all,any,both,each,few,more,most,other,some,such,no,nor,not,only,own,same,so,than,too,very,can,will,just,should,now,is,are,was,were,be,been,being,have,has,had,having,do,does,did,doing,would,could,ought,i,you,he,she,it,we,they,them,their,this,that,these,those,am,as,of,its,my,your,his,her,our"+
",а,но,или,если,то,тогда,так,также,вот,вон,это,эта,эти,этот,к,ко,в,во,на,над,под,о,об,от,до,для,при,без,через,между,из,у,с,со,не,ни,нет,да,же,ж,ли,бы,б,ведь,вон,там,тут,здесь,как,какой,какая,какие,который,которая,которые,что,чтобы,кто,меня,мне,мы,нас,вы,вас,он,она,они,его,ее,их,тебя,себя,мой,моя,мое,мои,твой,твоя,свой,своя,наш,ваш,весь,вся,все,каждый,другой,сам,сама,уже,еще,только,лишь,даже,очень,более,менее,можно,нужно,есть,быть,был,была,были,было,будет,будут,него,нее,когда,или").split(","));

/* Розбиття на речення (копія логіки BridgeCore). */
function splitSentences(text){
  return String(text||"")
    .replace(/\s+/g," ")
    .split(/(?<=[.!?…])\s+(?=[А-ЯA-ZІЇЄҐЁ])/u)
    .map(s=>s.trim())
    .filter(s=>s.length>1);
}

/* Токенізація: літери unicode, нижній регістр, без стоп-слів (копія BridgeCore). */
function tokenize(text){
  return String(text||"").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu," ")
    .split(" ")
    .map(w=>w.trim())
    .filter(w=>w.length>2&&!STOP.has(w)&&!/\d/.test(w));
}

function wordFreq(tokens){
  const m=new Map();
  for(const w of tokens)m.set(w,(m.get(w)||0)+1);
  return m;
}

/* ---------------- Детекція заголовків ---------------- */

/* Markdown-заголовок (# …): повертає очищений текст або null. */
function mdHeading(line){
  const m=/^(#{1,6})\s+(.*)$/.exec(line.trim());
  if(!m)return null;
  const h=m[2].replace(/\s+#+$/,"").trim();
  return h.length?h:null;
}

/* КАПС-рядок: ≥2 літер, усі великі, <60 символів, без кінцевої пунктуації речення. */
function isCapsLine(line){
  const t=line.trim();
  if(t.length<2||t.length>=60)return false;
  if(/[.!?…:;,—-]$/.test(t))return false;
  const letters=t.replace(/[^\p{L}]/gu,"");
  if(letters.length<2)return false;
  return letters===letters.toUpperCase()&&letters!==letters.toLowerCase();
}

/* Короткий рядок (<60 символів) перед порожнім рядком, схожий на заголовок:
   не кінець речення, не маркер списку, починається з великої літери. */
function isShortHeading(lines,i){
  const t=lines[i].trim();
  if(t.length<2||t.length>=60)return false;
  if(i+1>=lines.length||lines[i+1].trim()!=="")return false; /* має бути перед порожнім рядком */
  if(/[.!?…:;,—-]$/.test(t))return false;
  if(/^([-*•‣]|\d+[.)])\s/.test(t))return false;
  if(!/\p{L}/u.test(t))return false;
  if(!/^\p{Lu}/u.test(t))return false;
  return true;
}

/* Розбити текст на розділи: [{heading: string|null, body: string}]. */
function splitByHeadings(text){
  const t=String(text==null?"":text);
  if(!t.trim())return[];
  const lines=t.split(/\r?\n/);
  const sections=[];
  let heading=null,body=[];
  const flush=()=>{
    const b=body.join("\n").trim();
    if(heading!==null||b)sections.push({heading:heading,body:b});
    heading=null;body=[];
  };
  for(let i=0;i<lines.length;i++){
    const raw=lines[i];
    if(raw.trim()===""){body.push(raw);continue;}
    let h=mdHeading(raw);
    if(h===null&&isCapsLine(raw))h=raw.trim();
    if(h===null&&isShortHeading(lines,i))h=raw.trim();
    if(h!==null){flush();heading=h;}
    else body.push(raw);
  }
  flush();
  return sections;
}

/* ---------------- Резюме під кожним заголовком ---------------- */

/* Екстрактивний відбір n речень: TF-скоринг (локальна частота слів у розділі),
   бонус позиції, штраф за довжину. Детерміновано: нічиї за індексом. */
function pickTopSentences(sentences,n){
  if(!sentences.length)return[];
  if(sentences.length<=n)return sentences.slice();
  const freq=wordFreq(tokenize(sentences.join(" ")));
  const scored=sentences.map((s,i)=>{
    const toks=tokenize(s);
    if(!toks.length)return{i:i,s:s,score:-1};
    const tf=toks.reduce((a,w)=>a+(freq.get(w)||0),0)/toks.length;
    const pos=i===0?1.3:(i===sentences.length-1?0.7:1.0);
    const lenPen=toks.length<4?0.4:(toks.length>40?0.7:1.0);
    return{i:i,s:s,score:tf*pos*lenPen};
  }).filter(x=>x.score>0);
  return scored.sort((a,b)=>b.score-a.score||a.i-b.i)
    .slice(0,n)
    .sort((a,b)=>a.i-b.i)
    .map(x=>x.s);
}

/* Резюме зі структурою: [{heading, summary: string[]}], n речень під кожним.
   Текст без заголовків → один розділ з heading: null. */
function summarizeStructured(text,n){
  n=Math.max(1,Math.min(10,Number.isFinite(+n)?Math.floor(+n):3));
  const sections=splitByHeadings(text);
  return sections.map(sec=>({
    heading:sec.heading,
    summary:pickTopSentences(splitSentences(sec.body),n)
  }));
}

module.exports={
  name:"9-structured-summary",
  description:"Резюме зі збереженням структури: розбиття тексту на розділи за заголовками (Markdown #, КАПС-рядки, короткі рядки перед порожнім рядком) і екстрактивне резюме з n речень під кожним заголовком за TF-скорингом.",
  functions:{splitByHeadings:splitByHeadings,summarizeStructured:summarizeStructured}
};

return module.exports;})();
/* --- #10: summarizeMulti --- */
const __imp10=(function(){var module={exports:{}};
/* Агент 10: мульти-документне резюме (summarizeMulti).
   Самодостатній модуль: хелпери скопійовано з BridgeCore, zero dependencies. */
"use strict";

/* Стоп-слова uk/en/ru (скорочений набір із BridgeCore). */
const STOP = new Set(("а,але,бо,був,була,були,було,буде,будуть,в,вас,весь,від,він,вона,вони,воно,все,всіх,ви,для,до,де,ж,же,з,за,й,його,її,їх,і,із,чи,як,яка,який,які,яку,мене,мені,ми,на,над,нас,не,немає,ні,о,об,ось,під,по,про,с,свій,своя,свої,так,таки,там,те,ти,то,тобто,тоді,тільки,у,це,цей,ця,ці,цю,що,щоб,я,йому,тебе,нього,неї,коли,якщо,або,надто,вже,ще,також,між,через,при,без,кожен,кожна,інший,інша,саме,лише,навіть,дуже,більше,менше,можна,треба,є,нема,от" +
",the,a,an,and,or,but,if,then,else,when,at,by,for,with,about,into,through,during,before,after,above,below,to,from,up,down,in,out,on,off,over,under,again,further,once,here,there,all,any,both,each,few,more,most,other,some,such,no,nor,not,only,own,same,so,than,too,very,can,will,just,should,now,is,are,was,were,be,been,being,have,has,had,having,do,does,did,doing,would,could,ought,i,you,he,she,it,we,they,them,their,this,that,these,those,am,as,of,its,my,your,his,her,our" +
",но,или,если,то,тогда,так,также,вот,это,эта,эти,этот,к,ко,во,на,над,под,о,об,от,до,для,при,без,через,между,из,у,с,со,не,ни,нет,да,же,ж,ли,бы,б,ведь,там,тут,здесь,как,какой,какая,какие,который,которая,которые,что,чтобы,кто,меня,мне,мы,нас,вы,вас,он,она,они,его,ее,их,тебя,себя,мой,моя,мое,мои,твой,твоя,свой,своя,наш,ваш,весь,вся,все,каждый,другой,сам,сама,уже,еще,только,лишь,даже,очень,более,менее,можно,нужно,есть,быть,был,была,были,было,будет,будут,него,нее,когда,или").split(","));

/* Розбити текст на речення. */
function splitSentences(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?…])\s+(?=[А-ЯA-ZІЇЄҐЁ])/u)
    .map(s => s.trim())
    .filter(s => s.length > 1);
}

/* Токенізація: літери (unicode), нижній регістр, без стоп-слів і сміття. */
function tokenize(text) {
  return String(text || "").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .map(w => w.trim())
    .filter(w => w.length > 2 && !STOP.has(w) && !/\d/.test(w));
}

/* Спільний префікс ≥5 символів — грубе стем-порівняння. */
function stemMatch(a, b) {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5) return false;
  let i = 0; const n = Math.min(a.length, b.length);
  while (i < n && a[i] === b[i]) i++;
  return i >= 5;
}

function wordFreq(tokens) {
  const m = new Map();
  for (const w of tokens) m.set(w, (m.get(w) || 0) + 1);
  return m;
}

/* Топ слів документа з частотами (обмеження TOP_K для перетину). */
function topWords(text, k) {
  const freq = wordFreq(tokenize(text));
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, Math.max(1, k || 15));
}

/* Згрупувати слова за stemMatch; група = «тема».
   Повертає теми, що зустрічаються у >=2 документах.
   Кожна тема: { forms: [форми з документів], docs: Set(індекси), weight: сума частот } */
function findCommonThemes(docTopWords) {
  const themes = [];
  docTopWords.forEach((words, di) => {
    for (const [word, count] of words) {
      let theme = themes.find(t => t.forms.some(f => stemMatch(f, word)));
      if (!theme) {
        theme = { forms: [], docs: new Set(), weight: 0 };
        themes.push(theme);
      }
      if (!theme.forms.some(f => stemMatch(f, word))) theme.forms.push(word);
      if (!theme.docs.has(di)) theme.docs.add(di);
      theme.weight += count;
    }
  });
  return themes.filter(t => t.docs.size >= 2);
}

/* Перевірити, чи токен речення належить спільній темі. */
function sentenceThemeHits(sentTokens, themes) {
  let hits = 0, weight = 0;
  for (const t of sentTokens) {
    const th = themes.find(th => th.forms.some(f => stemMatch(f, t)));
    if (th) { hits++; weight += th.weight; }
  }
  return { hits, weight };
}

/* Мульти-документне резюме.
   docs — масив текстів (порожні/не-рядки ігноруються).
   n — бажана кількість речень (за замовчуванням 3, мін 1, макс 10).
   Порядок результату: спочатку за документом, потім за позицією речення
   (цей порядок обрано, щоб резюме читалось як цілісний текст, а не як
   мішанина найвищих оцінок із різних місць; оцінка використовується лише
   для відбору топ-N).
   Джерела не позначаються — повертаються лише рядки речень. */
function summarizeMulti(docs, n) {
  n = Math.max(1, Math.min(10, n || 3));
  if (!Array.isArray(docs)) return [];
  const texts = docs.filter(d => typeof d === "string" && d.trim().length > 0);
  if (!texts.length) return [];

  const TOP_K = 15;              // скільки топ-слів брати з кожного документа
  const THEME_BONUS = 2.0;       // вага спільних тем в оцінці речення

  const docTopWords = texts.map(t => topWords(t, TOP_K));
  const themes = findCommonThemes(docTopWords);

  // Зібрати всі речення всіх документів: {di, pos, text}
  const all = [];
  texts.forEach((t, di) => {
    splitSentences(t).forEach((s, pos) => all.push({ di, pos, text: s }));
  });
  if (!all.length) return [];

  // TF за всіма документами разом (глобальна частота)
  const globalFreq = wordFreq(tokenize(texts.join(" ")));

  const scored = all.map(item => {
    const toks = tokenize(item.text);
    if (!toks.length) return { ...item, score: -1 };
    const tf = toks.reduce((a, w) => a + (globalFreq.get(w) || 0), 0) / toks.length;
    const { hits } = sentenceThemeHits(toks, themes);
    // Бонус за спільні теми: частка токенів речення, що належать темам, × THEME_BONUS
    const themeBonus = (hits / toks.length) * THEME_BONUS;
    const posBonus = item.pos === 0 ? 1.2 : 1.0;   // перші речення документів трохи важливіші
    const lenPenalty = toks.length < 4 ? 0.4 : (toks.length > 40 ? 0.7 : 1.0);
    return { ...item, score: (tf + themeBonus) * posBonus * lenPenalty };
  }).filter(x => x.score > 0);

  if (!scored.length) return [];

  // Відбір топ-N за оцінкою, упорядкування за документом і позицією.
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .sort((a, b) => a.di - b.di || a.pos - b.pos)
    .map(x => x.text);
}

module.exports = {
  name: "10-multi-doc-summary",
  description: "Мульти-документне резюме: знаходить спільні теми у 2+ документах (перетин топ-слів зі стем-порівнянням) та повертає топ-N речень за TF-оцінкою з бонусом за спільні теми, упорядковані за документом і позицією.",
  functions: { summarizeMulti }
};

return module.exports;})();
/* --- #11: detectQuestionType --- */
const __imp11=(function(){var module={exports:{}};
/* improvement_11.js — агент 11: детекція типу питання.
   Чистий JavaScript, zero dependencies. Самодостатній модуль (CommonJS),
   не залежить від BridgeCore. Перевіряє початок питання (перші 1–2 слова)
   у нижньому регістрі, три мови: українська, англійська, російська. */
"use strict";

/* Двохслівні питальні фрази: тип → список фраз (перевіряються першими). */
const PHRASES = {
  who: ["хто саме"],
  why: ["чому саме"],
  how: ["каким образом", "how many", "how much"]
};

/* Однослівні питальні слова: тип → список слів. */
const WORDS = {
  who: ["хто", "кто", "who", "whom", "whose"],
  what: ["що", "який", "яка", "яке", "які", "что", "какой", "what", "which"],
  when: ["коли", "когда", "when"],
  where: ["де", "куди", "звідки", "где", "куда", "откуда", "where"],
  why: ["чому", "навіщо", "почему", "зачем", "why"],
  how: ["як", "скільки", "как", "how"]
};

/* Початки закритих (так/ні) питань. */
const YESNO_PREFIXES = ["чи ", "ли ", "is ", "are ", "do ", "does ", "did ", "can "];

/* Перші n слів початку рядка: нижній регістр, лише літери. */
function firstWords(text, n) {
  return (String(text || "").toLowerCase().match(/[\p{L}]+/gu) || []).slice(0, n);
}

/* Визначити тип питання: "who"|"what"|"when"|"where"|"why"|"how"|"yesno"|"other".
   Порожній рядок / null → "other", винятків не кидає. */
function detectQuestionType(question) {
  const low = String(question || "").toLowerCase().trim();
  if (!low) return "other";
  const words = firstWords(low, 2);

  /* 1) Двохслівні фрази: «хто саме», «чому саме», «how much», … */
  if (words.length === 2) {
    const pair = words[0] + " " + words[1];
    for (const type of Object.keys(PHRASES)) {
      if (PHRASES[type].indexOf(pair) !== -1) return type;
    }
  }

  /* 2) Перше слово за словниками питальних слів. */
  if (words.length >= 1) {
    const w = words[0];
    for (const type of Object.keys(WORDS)) {
      if (WORDS[type].indexOf(w) !== -1) return type;
    }
  }

  /* 3) Закриті так/ні питання («Чи …?», «Is …?»). */
  for (const p of YESNO_PREFIXES) {
    if (low.startsWith(p)) return "yesno";
  }

  return "other";
}

module.exports = {
  name: "11-question-type",
  description: "Детекція типу питання (who/what/when/where/why/how/yesno/other) за першими 1–2 словами, три мови: українська, англійська, російська.",
  functions: { detectQuestionType }
};

return module.exports;})();
/* --- #12: extractEntities --- */
const __imp12=(function(){var module={exports:{}};
/* Покращення №12 — пошук іменованих сутностей (NER).
   extractEntities(text) → {persons, places, orgs, dates}.
   Чистий JS, zero dependencies, без мережі. Самодостатній модуль. */
"use strict";

/* ---------- базові хелпери (власні) ---------- */

/* Розбити текст на речення (логіка як у core.js). */
function splitSentences(text){
  return String(text||"")
    .replace(/\s+/g," ")
    .split(/(?<=[.!?…])\s+(?=[А-ЯA-ZІЇЄҐЁ])/u)
    .map(s=>s.trim())
    .filter(s=>s.length>1);
}

/* Слово з великої літери: «Іван», «John», «Марія-Анна», «O'Neill». */
const CAPW_RE=/^[\p{Lu}][\p{Ll}]+(['’ʼ-][\p{Lu}\p{Ll}][\p{Ll}]+)*$/u;
function isCapWord(w){ return CAPW_RE.test(w); }

/* Усі слова речення з їх позиціями. */
function wordsWithOffsets(s){
  const out=[]; const re=/[\p{L}][\p{L}'’ʼ-]*/gu; let m;
  while((m=re.exec(s))) out.push({w:m[0], i:m.index});
  return out;
}

/* Дедуплікація зі збереженням порядку першої появи. */
function dedupKeepOrder(arr){
  const seen=new Set(); const out=[];
  for(const x of arr){
    const k=String(x).toLowerCase().replace(/\s+/g," ").trim();
    if(!seen.has(k)){ seen.add(k); out.push(String(x).trim()); }
  }
  return out;
}

/* Перетин інтервалів [s,e) зі списком зайнятих. */
function overlaps(busy,s,e){
  for(const b of busy) if(b.start<e && s<b.end) return true;
  return false;
}

/* ---------- словники ---------- */

/* Організаційні маркери зі специфікації. */
const ORG_MARKERS_UK=["ТОВ","ПАТ","ПрАТ","ФОП"];
const ORG_MARKERS_EN=["Inc.","Ltd.","LLC","Corp.","GmbH"];
const ORG_MARKER_SET=new Set(
  ORG_MARKERS_UK.concat(ORG_MARKERS_EN).map(m=>m.toLowerCase().replace(/\./g,""))
);

/* Гео-маркери: основи слів, щоб ловити відмінки («місті», «вулиці», «cities»). */
const GEO_STEMS=[
  "міст","вулиц","країн","област","сел","селищ","проспект","площ",
  "бульвар","провулок","район","річк","озер",
  "cit","town","villag","street","avenu","countr","region",
  "state","province","river","square","district"
];
function isGeoMarkerWord(w){
  const low=w.toLowerCase();
  return GEO_STEMS.some(s=>low.startsWith(s));
}

/* Короткий список столиць: основи для укр. відмінків + en назви. */
const CAPITAL_STEMS=[
  "київ","києв","львів","львов","одес","харків","харков","дніпр",
  "запоріж","запорож","варшав","краків","краков","берлін","париж",
  "лондон","мадрид","рим","віден","праг","праз","торонто",
  "нью-йорк","new york","чикаго","chicago","лос-анджелес","los angeles",
  "kyiv","kiev","lviv","odesa","odessa","kharkiv","dnipro",
  "warsaw","krakow","berlin","paris","london","madrid","rome",
  "vienna","prague","toronto"
];
/* Цілісні назви столиць (для відсіву з персон). */
const CAPITAL_PHRASES=new Set([
  "київ","львів","одеса","харків","дніпро","запоріжжя","варшава","краків",
  "берлін","париж","лондон","мадрид","рим","відень","прага","торонто",
  "нью-йорк","чикаго","лос-анджелес",
  "kyiv","kiev","lviv","odesa","odessa","kharkiv","dnipro","warsaw",
  "krakow","berlin","paris","london","madrid","rome","vienna","prague",
  "toronto","new york","chicago","los angeles"
]);
function isCapitalPhrase(low){
  return CAPITAL_PHRASES.has(low.replace(/[–—]/g,"-"));
}

/* Титули/посади на початку послідовності — не частина імені. */
const TITLE_WORDS=new Set([
  "президент","президентка","директор","директорка","міністр","міністерка",
  "мер","голова","начальник","начальниця","посол","послиня","депутат",
  "депутатка","генерал","професор","професорка","доктор","докторка",
  "пан","пані","панове",
  "mr","mrs","ms","miss","dr","sir","madam","president","director",
  "minister","mayor","chief","professor","doctor","ambassador",
  "senator","governor"
]);

/* Типові прислівники/сполучники на початку речення — не частина імені
   («Потім Олена Ковальчук» → «Олена Ковальчук»). */
const STARTER_WORDS=new Set([
  "потім","вчора","сьогодні","завтра","зараз","тут","там","тоді","також",
  "але","проте","однак","тому","отже","нарешті","раптом","звісно",
  "звичайно","наприклад","справді","нажаль","власне",
  "then","today","yesterday","tomorrow","now","here","there","however",
  "finally","suddenly","also","therefore"
]);
const KNOWN_ORGS=new Set([
  "верховна рада","кабінет міністрів","національний банк",
  "європейський союз","european union","united nations","організація об'єднаних націй"
]);

/* ---------- регулярні вирази ---------- */

const CAP1="[\\p{Lu}][\\p{Ll}]+(?:['’ʼ-][\\p{Lu}\\p{Ll}][\\p{Ll}]+)*";
const QUO="«»\"“”‘’'";

/* Організації: «ТОВ "Веселка"», «ФОП Шевченко», «Apple Inc.», «Google LLC». */
const RE_ORG_UK=new RegExp(
  "(ТОВ|ПАТ|ПрАТ|ФОП)\\s+["+QUO+"]?("+CAP1+"(?:\\s+"+CAP1+"){0,2})["+QUO+"]?","gu");
const RE_ORG_EN=new RegExp(
  "(["+QUO+"]?"+CAP1+"(?:\\s+"+CAP1+"){0,2}["+QUO+"]?)\\s+(Inc\\.|Ltd\\.|LLC|Corp\\.|GmbH)(?=\\s|$|[^\\p{L}])","gu");

const WB="(?<![\\p{L}])"; /* межа слова: V8 ламає \b перед кирилицею, тому lookbehind */
/* Місця: маркер + назва («місто Львів», «вулиця Шевченка», «city of London»). */
const GEO_ALT=GEO_STEMS.join("|");
const RE_PLACE_AFTER=new RegExp(
  WB+"(?:"+GEO_ALT+")\\p{Ll}*(?:\\s+(?:of|у|в|на|біля|до))?\\s+("+CAP1+"(?:\\s+"+CAP1+"){0,2})","giu");
/* Місця: назва + маркер («Київська область», «Львівська область»). */
const RE_PLACE_BEFORE=new RegExp(
  WB+"("+CAP1+"(?:\\s+"+CAP1+")?)\\s+((?:"+GEO_ALT+")\\p{Ll}*)(?![\\p{L}])","giu");
/* Місця: столиці зі списку (ловлять відмінки: «Києва», «Варшаву»). */
const RE_CAPITAL=new RegExp(
  WB+"("+CAPITAL_STEMS.join("|")+")\\p{Ll}*","giu");

/* Дати: DD.MM.YYYY та YYYY-MM-DD, сирі рядки. */
const RE_DATE=/\b\d{1,2}\.\d{1,2}\.\d{4}\b|\b\d{4}-\d{1,2}-\d{1,2}\b/g;

/* ---------- пошук персон ---------- */

/* Послідовності 2+ слів з великої літери. Перше слово речення
   саме по собі не рахується (вимога: відсікати початки речень). */
function findPersons(sentence,busy){
  const words=wordsWithOffsets(sentence);
  const out=[];
  let i=0;
  while(i<words.length){
    if(isCapWord(words[i].w)){
      let j=i;
      while(j+1<words.length && isCapWord(words[j+1].w) &&
            /^\s*$/.test(sentence.slice(words[j].i+words[j].w.length,words[j+1].i))){
        j++;
      }
      let run=words.slice(i,j+1);
      /* Скинути титул/прислівник на початку: «Директор Іван Петренко», «Потім Олена Ковальчук». */
      while(run.length>2 && (TITLE_WORDS.has(run[0].w.toLowerCase()) || STARTER_WORDS.has(run[0].w.toLowerCase()))) run=run.slice(1);
      /* Якщо після цього лишилось <2 слів або перше слово — титул: не персона. */
      if(run.length>=2 && !TITLE_WORDS.has(run[0].w.toLowerCase()) && !STARTER_WORDS.has(run[0].w.toLowerCase())){
        const text=run.map(x=>x.w).join(" ");
        const start=run[0].i;
        const last=run[run.length-1];
        const end=last.i+last.w.length;
        const low=text.toLowerCase();
        const hasMarker=run.some(x=>
          isGeoMarkerWord(x.w) || ORG_MARKER_SET.has(x.w.toLowerCase().replace(/\./g,"")));
        if(!overlaps(busy,start,end) && !hasMarker &&
           !KNOWN_ORGS.has(low) && !isCapitalPhrase(low)){
          out.push({text,start,end});
        }
      }
      i=j+1;
    }else{
      i++;
    }
  }
  return out;
}

/* ---------- головна функція ---------- */

/* extractEntities(text) → {persons, places, orgs, dates}.
   Порядок появи в тексті, дедуплікація. Порожній вхід → порожні масиви. */
function extractEntities(text){
  const empty={persons:[],places:[],orgs:[],dates:[]};
  if(text==null) return empty;
  const t=String(text);
  if(!t.trim()) return empty;

  const persons=[],places=[],orgs=[],dates=[];

  for(const s of splitSentences(t)){
    const busy=[]; /* зайняті інтервали речення */

    /* 1) Організації за маркерами. */
    for(const re of [RE_ORG_UK,RE_ORG_EN]){
      re.lastIndex=0; let m;
      while((m=re.exec(s))){
        const name=m[0].trim();
        if(name.length>2){
          orgs.push(name);
          busy.push({start:m.index,end:m.index+m[0].length});
        }
      }
    }

    /* 2) Місця: гео-маркери поруч. */
    for(const re of [RE_PLACE_AFTER,RE_PLACE_BEFORE]){
      re.lastIndex=0; let m;
      while((m=re.exec(s))){
        const name=m[0].trim();
        if(name.length>1 && !overlaps(busy,m.index,m.index+m[0].length)){
          places.push(name);
          busy.push({start:m.index,end:m.index+m[0].length});
        }
      }
    }

    /* 3) Місця: столиці зі списку. */
    RE_CAPITAL.lastIndex=0; let cm;
    while((cm=RE_CAPITAL.exec(s))){
      const name=cm[0].trim();
      if(!overlaps(busy,cm.index,cm.index+cm[0].length)){
        places.push(name);
        busy.push({start:cm.index,end:cm.index+cm[0].length});
      }
    }

    /* 4) Персони: 2+ слів з великої літери. */
    for(const p of findPersons(s,busy)){
      persons.push(p.text);
      busy.push({start:p.start,end:p.end});
    }

    /* 5) Дати простим патерном. */
    RE_DATE.lastIndex=0; let dm;
    while((dm=RE_DATE.exec(s))) dates.push(dm[0]);
  }

  return{
    persons:dedupKeepOrder(persons),
    places:dedupKeepOrder(places),
    orgs:dedupKeepOrder(orgs),
    dates:dedupKeepOrder(dates)
  };
}

module.exports={
  name:"12-entity-extraction",
  description:"Пошук іменованих сутностей: extractEntities(text) → персони, місця, організації, дати (укр+en).",
  functions:{extractEntities}
};

return module.exports;})();
/* --- #13: extractDatesNumbers --- */
const __imp13=(function(){var module={exports:{}};
/* Агент 13: витяг дат і чисел з тексту.
   extractDatesNumbers(text) -> { dates: [{raw}], numbers: [{raw, value, unit}] }
   Дати: DD.MM.YYYY, DD/MM/YYYY, YYYY-MM-DD, словесні укр/англ (повні + скорочені місяці).
   Числа: з одиницями (100 км, $50, 10%) або без (3.14, 1 000 000).
   Порядок появи, дедуплікація за raw. Чистий JS, zero dependencies, без мережі. */
"use strict";

/* Назви місяців: українські (називний + родовий відмінки),
   англійські повні та скорочені. */
const UK_MONTHS = [
  "січень","січня","лютий","лютого","березень","березня","квітень","квітня",
  "травень","травня","червень","червня","липень","липня","серпень","серпня",
  "вересень","вересня","жовтень","жовтня","листопад","листопада","грудень","грудня"
];
const EN_MONTHS = [
  "january","february","march","april","may","june",
  "july","august","september","october","november","december"
];
const EN_MONTHS_ABBR = [
  "jan","feb","mar","apr","may","jun","jul","aug","sept","sep","oct","nov","dec"
];

/* Довші назви першими: «september» раніше за «sept», «вересня» раніше за «вер». */
const MONTH_ALT = [...new Set([...UK_MONTHS, ...EN_MONTHS, ...EN_MONTHS_ABBR])]
  .sort((a, b) => b.length - a.length).join("|");

/* Комбінований патерн дат. Довші формати першими, щоб «4 жовтня 2026»
   не розпадалося на «жовтня 2026». \p{L}\p{N} замість \b — бо \b не бачить кирилицю. */
const DATE_RE = new RegExp(
  String.raw`(?<![\p{L}\p{N}])` +
  String.raw`(?:` +
    String.raw`\d{4}-\d{2}-\d{2}` +                                    // 2026-10-04
    String.raw`|\d{1,2}\.\d{1,2}\.\d{4}` +                             // 04.10.2026
    String.raw`|\d{1,2}/\d{1,2}/\d{4}` +                               // 04/10/2026
    String.raw`|\d{1,2}\s+(?:` + MONTH_ALT + String.raw`)\s+\d{4}` +    // 4 жовтня 2026 / 4 October 2026
    String.raw`|(?:` + MONTH_ALT + String.raw`)\s+\d{1,2},?\s+\d{4}` +  // October 4, 2026 / Oct 4 2026
    String.raw`|(?:` + MONTH_ALT + String.raw`)\s+\d{4}` +             // жовтня 2026 / October 2026
  String.raw`)` +
  String.raw`(?![\p{L}\p{N}])`,
  "giu"
);

/* Допустимі одиниці виміру: довші першими («км/год» раніше за «км», «см» раніше за «с»). */
const UNITS = [
  "км/год","km/h",
  "км","km","мм","mm","см","cm","м","m",
  "кг","kg","т","t","г","g",
  "грн","uah","usd","eur",
  "год","хв","сек","с","шт",
  "%","$","€","₴","£"
];
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const UNIT_ALT = UNITS.slice().sort((a, b) => b.length - a.length).map(escRe).join("|");

/* Число: префікс-валюта ($50, € 20), тисячні пробіли (1 000 000), десяткові . або , (3.14 / 3,14),
   суфікс-одиниця (100 км, 10%). Негативний перегляд — щоб не різати «5.11.70» на шматки. */
const NUM_RE = new RegExp(
  String.raw`(?<![\p{L}\p{N}._])` +
  String.raw`(?:(?<cur>[$€₴£]|USD|EUR|UAH|грн\.?)\s*)?` +
  "(?<num>\\d{1,3}(?:[\\s\\u00A0\\u202F]\\d{3})+(?:[.,]\\d+)?|\\d+(?:[.,]\\d+)?)" +
  String.raw`(?![.,]?\d)` +
  String.raw`(?:\s*(?<unit>` + UNIT_ALT + String.raw`))?` +
  String.raw`(?![\p{L}\p{N}])`,
  "giu"
);

/* Перетворити текстовий запис числа у float: «1 000 000» -> 1000000, «3,14» -> 3.14. */
function parseNumber(numStr) {
  const s = String(numStr).replace(/[\s\u00A0\u202F]/g, "");
  const hasDot = s.indexOf(".") !== -1;
  const hasComma = s.indexOf(",") !== -1;
  let dec = s;
  if (hasDot && hasComma) {
    // Останній роздільник — десятковий, решта — тисячні.
    const decSep = s.lastIndexOf(".") > s.lastIndexOf(",") ? "." : ",";
    dec = "";
    for (const ch of s) {
      if (ch === "." || ch === ",") { if (ch === decSep) dec += "."; }
      else dec += ch;
    }
  } else if (hasComma) {
    if (/^\d{1,3}(?:,\d{3})+$/.test(s)) dec = s.replace(/,/g, ""); // 1,000,000
    else dec = s.replace(",", ".");                               // 3,14
  } else if (hasDot) {
    if (/^\d{1,3}(?:\.\d{3})+$/.test(s)) dec = s.replace(/\./g, ""); // 1.000
  }
  const v = parseFloat(dec);
  return Number.isFinite(v) ? v : 0;
}

/* Витяг дат і чисел. Порядок появи, дедуплікація за raw.
   Числа всередині знайдених дат (день/рік) як числа не повертаються. */
function extractDatesNumbers(text) {
  const t = String(text || "");
  const dates = [];
  const numbers = [];
  const seenDates = new Set();
  const seenNums = new Set();
  const occupied = []; // діапазони [start, end) знайдених дат

  DATE_RE.lastIndex = 0;
  let m;
  while ((m = DATE_RE.exec(t)) !== null) {
    const raw = m[0];
    occupied.push([m.index, m.index + raw.length]);
    if (!seenDates.has(raw)) {
      seenDates.add(raw);
      dates.push({ raw });
    }
  }
  const insideDate = (a, b) => occupied.some(([s, e]) => a < e && b > s);

  NUM_RE.lastIndex = 0;
  while ((m = NUM_RE.exec(t)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (insideDate(start, end)) continue; // шматок дати — не число
    const raw = m[0];
    if (seenNums.has(raw)) continue;
    seenNums.add(raw);
    const cur = (m.groups.cur || "").replace(/\s+$/, "");
    const suffix = m.groups.unit || null;
    numbers.push({ raw, value: parseNumber(m.groups.num), unit: cur || suffix || null });
  }

  return { dates, numbers };
}

module.exports = {
  name: "13-extract-dates-numbers",
  description: "Витяг дат (числових і словесних, укр/англ) та чисел з одиницями виміру з тексту, у порядку появи.",
  functions: { extractDatesNumbers }
};

return module.exports;})();
/* --- #14: extractQuotes --- */
const __imp14=(function(){var module={exports:{}};
/* improvement_14.js — витяг цитат з тексту (агент 14).
   Чистий JS, zero dependencies, без мережевих викликів. */

"use strict";

/* Знайти автора поруч із цитатою:
   - після цитати: тире/дефіс (—, –, -) + ім'я/прізвище;
   - перед цитатою: ім'я + дієслово мовлення (сказав, каже, написав...) + ':'.
   Повертає рядок або null. */
function findAuthor(text, quoteStart, quoteEnd) {
  // Патерн: тире/дефіс після цитати, потім ім'я автора.
  const after = text.slice(quoteEnd, quoteEnd + 120);
  const mAfter = after.match(/^\s*[,;]?\s*[—–-]\s*([А-ЯA-ZІЇЄҐЁ][\p{L}]+(?:\s+[А-ЯA-ZІЇЄҐЁ][\p{L}]+){0,2})/u);
  if (mAfter) return mAfter[1].trim();

  // Патерн: автор перед цитатою — «Іван сказав:», «John said:».
  const before = text.slice(Math.max(0, quoteStart - 120), quoteStart);
  const mBefore = before.match(/([А-ЯA-ZІЇЄҐЁ][\p{L}]+(?:\s+[А-ЯA-ZІЇЄҐЁ][\p{L}]+){0,2})\s+(?:сказав|сказала|каже|говорить|заявив|заявила|написав|написала|додав|додала|відповів|відповіла|сказали|said|says|wrote|added|replied|stated|told|сказал|сказала|говорит|заявил|заявила)\s*[:\s]*$/u);
  if (mBefore) return mBefore[1].trim();

  return null;
}

/* Витягнути цитати з тексту.
   Цитати в лапках: «», „", "", '', «».
   Повертає [{quote: string, author: string|null}]. */
function extractQuotes(text) {
  if (text == null) return [];
  const src = String(text);
  if (!src.trim()) return [];

  // Пари лапок: відкриваюча -> закриваюча.
  const pairs = [
    ["«", "»"],
    ["„", '"'],
    ["\u201C", "\u201D"], // “ ”
    ['"', '"'],
    ["\u2018", "\u2019"], // ‘ ’
    ["'", "'"]
  ];

  const results = [];

  for (const [open, close] of pairs) {
    let idx = 0;
    while (idx < src.length) {
      const start = src.indexOf(open, idx);
      if (start === -1) break;

      // Для однакових відкриваючих/закриваючих (", ') шукаємо наступне входження.
      const end = src.indexOf(close, start + open.length);
      if (end === -1) break;

      const quote = src.slice(start + open.length, end).trim();

      // Багаторядкові блоки «> » або відступи: теж приймаємо як частину цитати
      // (уже враховані, бо беремо весь текст між лапками).

      if (quote.length > 3) {
        // Перевіряємо, що лапка не всередині слова (апостроф: don't, it's).
        const beforeChar = start > 0 ? src[start - 1] : " ";
        const isApostrophe = (open === "'" || open === "\u2018") && /\p{L}/u.test(beforeChar);
        if (!isApostrophe) {
          // Уникаємо дублікатів (напр. '' перетинається з іншими парами).
          const dup = results.some(r => r.quote === quote);
          if (!dup) {
            results.push({ quote, author: findAuthor(src, start, end + close.length) });
          }
        }
      }
      idx = end + close.length;
    }
  }

  // Сортуємо за порядком появи в тексті.
  results.sort((a, b) => src.indexOf(a.quote) - src.indexOf(b.quote));

  return results;
}

module.exports = {
  name: "14-extract-quotes",
  description: "Витягає цитати в лапках («», „\", «») разом з автором (за тире після цитати або дієсловом мовлення перед нею)",
  functions: { extractQuotes }
};

return module.exports;})();
/* --- #15: extractActionItems --- */
const __imp15=(function(){var module={exports:{}};
/* BridgeCore improvement #15 — витяг action items (завдань) з тексту.
   Написано координатором (агент 15 завис без результату).
   Чистий JS, zero dependencies. */

/* Розбити на речення (проста версія). */
function _split(text){
  return String(text||"")
    .replace(/\s+/g," ")
    .split(/(?<=[.!?…])\s+(?=[А-ЯA-ZІЇЄҐЁ])/u)
    .map(s=>s.trim())
    .filter(s=>s.length>1);
}

/* Маркери завдань. */
const MARKERS=[
  "todo","fixme","треба","потрібно","необхідно","слід","варто",
  "must","need to","needs to","should","todo","to-do","action item"
];

/* Закінчення наказового способу (укр): -й, -ь, -ай, -яй, -уй, -ій, -и, або
   приголосна (перевір, напиш). Друге слово не має бути дієсловом 3-ї особи
   (інакше це розповідне речення: "Птахи співають"). */
function _isVerbLike(word){
  const w=String(word||"").toLowerCase().replace(/[^а-яіїєґ]/g,"");
  return /(уть|ють|ать|ять|ить|їть|ає|яє|ує|ює|е|є)$/.test(w)&&w.length>=4;
}
function _looksImperative(sentence){
  const words=String(sentence||"").trim().split(/\s+/);
  if(words.length<2||words.length>10)return false;
  const first=words[0].toLowerCase().replace(/[^а-яіїєґ]/g,"");
  const second=words[1];
  if(first.length<4)return false;
  const impEnding=/(й|ь|ай|яй|уй|ій|ите|йте|імо|имо)$/.test(first)
    || (/(и)$/.test(first)&&first.length>=4)
    || (/[бвгджзклмнпрстфхцчшщ]$/.test(first)&&first.length>=6);
  if(!impEnding)return false;
  if(_isVerbLike(second))return false;
  return true;
}

/* Витягти речення-завдання. */
function extractActionItems(text){
  const t=String(text||"");
  if(!t.trim())return[];
  const out=[];
  const seen=new Set();
  /* 1. Рядки з чекбоксами / маркерами списків. */
  const lines=t.split("\n");
  for(const line of lines){
    const m=line.match(/^\s*(?:[-*•+]|\d+[.)]|\[ \])\s+(.+)$/);
    if(m&&m[1].trim().length>2){
      const item=m[1].trim();
      const low=item.toLowerCase();
      if(MARKERS.some(k=>low.includes(k))||_looksImperative(item)){
        if(!seen.has(item)){seen.add(item);out.push(item);}
      }
    }
    /* Чекбокс - [ ] / - [x]. */
    const cb=line.match(/^\s*-\s*\[[ x]\]\s+(.+)$/i);
    if(cb&&cb[1].trim().length>2){
      const item=cb[1].trim();
      if(!seen.has(item)){seen.add(item);out.push(item);}
    }
  }
  /* 2. Речення з маркерами або наказовим способом. */
  const sentences=_split(t);
  for(const s of sentences){
    if(seen.has(s))continue;
    const low=s.toLowerCase();
    const hasMarker=MARKERS.some(k=>low.includes(k));
    if(hasMarker||_looksImperative(s)){
      seen.add(s);out.push(s);
    }
  }
  return out;
}

module.exports={
  name:"15-action-items",
  description:"Витяг завдань (action items) з тексту: TODO-маркери, 'треба/потрібно/must', чекбокси, наказовий спосіб.",
  functions:{extractActionItems}
};

return module.exports;})();
/* --- #16: sentiment --- */
const __imp16=(function(){var module={exports:{}};
/* improvement_16.js — Агент 16: аналіз тональності тексту.
   Функція sentiment(text) → {label, score}.
   Словники: uk 80+ позитивних / 80+ негативних, en 50+ / 50+.
   Заперечення (не, ні, not, no) у вікні 2 слова інвертують полярність.
   Підсилювачі (дуже, very, "!") ×1.5.
   Чистий JS, zero dependencies, детерміновано. */

/* Позитивні слова: українська. */
const POS_UK = [
"чудово","чудовий","чудова","чудове","гарно","гарний","гарна","прекрасно","прекрасний","прекрасна",
"перемога","перемогти","переможець","радість","радісний","радісна","радіти","щастя","щасливий","щаслива",
"любов","кохання","кохати","любити","улюблений","улюблена","успіх","успішний","успішна","досягнення",
"вдача","вдалий","вдала","добре","добрий","добра","найкращий","найкраща","кращий","відмінно","відмінний",
"супер","класно","класний","приємно","приємний","приємна","злагода","мир","мирний","спокій","спокійний",
"надія","натхнення","натхненний","сила","сильний","потужний","гордість","пишатися","вдячність","вдячний",
"дякую","процвітання","розвиток","покращення","покращити","вигідно","вигода","користь","корисний","смачно",
"смачний","краса","красивий","гармонія","тепло","теплий","світло","світлий","сонячний","веселий","весело",
"сміх","посмішка","гумор","оптимізм","оптимістичний","віра","довіра","чесність","чесний","справедливість",
"справедливий","герой","мужність","мужній","відвага","мудрість","мудрий","розумний","талановитий","талант",
"креативний","геніальний","блискучий","дивовижний","неймовірний","фантастичний","чарівний","ідеальний","досконалий",
"комфорт","комфортний","затишок","безпека","безпечний","здоров'я","здоровий","енергія","енергійний","бадьорий",
"чистота","чистий","порядок","стабільність","надійність","надійний","якість","якісний","розкішний","багатство",
"щедрість","доброта","турбота","повага","гідність","свято","тріумф","слава","визнання","популярний",
"захоплення","мотивація","ентузіазм","задоволення","задоволений","відпочинок","пригода","відкриття","прогрес",
"мрія","мріяти","нагорода","подарунок","сюрприз","диво","чудо","свобода","дружба","друг","підтримка","шанс",
"можливість","перспектива","впевненість","рішучість","справедливий","величний","вишуканий","ефективний","корисний",
"життєрадісний","святковий","урочистий","благословення","життя","живий","свіжий","новий","ясність","ясний"
];

/* Негативні слова: українська. */
const NEG_UK = [
"погано","поганий","погана","жахливо","жахливий","жахлива","жах","біль","боляче","боліти",
"втрата","втратити","страждання","страждати","сум","сумний","сумна","сумно","смуток","печаль",
"горе","гіркий","сльози","плакати","депресія","тривога","тривожний","страх","боятися","паніка",
"панічний","гнів","злість","злий","лютий","ненависть","ненавидіти","образа","ворог","ворожий",
"війна","конфлікт","бійка","насильство","жорстокість","жорстокий","зло","крадіжка","брехня","брехати",
"обман","обманювати","шахрайство","шахрай","корупція","несправедливість","ганьба","сором","соромно","провал",
"провалити","невдача","невдалий","поразка","катастрофа","трагедія","трагічний","біда","нещастя","нещасний",
"загроза","загрозливий","небезпека","небезпечний","ризик","помилка","помилковий","вина","винний","покарання",
"злочин","в'язниця","арешт","хвороба","хворий","хворіти","смерть","померти","вбивство","вбити",
"кров","рана","поранений","травма","слабкість","слабкий","втома","втомлений","голод","голодний",
"бідність","бідний","борг","криза","безробіття","проблема","проблемний","труднощі","складність","складний",
"важкий","важко","тягар","перешкода","затримка","хаос","безлад","бруд","брудний","отрута",
"отруйний","токсичний","руйнування","руйнувати","знищення","пожежа","повінь","шторм","буря","холод",
"мороз","темрява","темний","похмурий","нудьга","нудний","апатія","байдужість","самотність","самотній",
"ізоляція","розлука","зрада","зрадити","ревнощі","заздрість","жадібність","жадібний","егоїзм","егоїстичний",
"гординя","лицемірство","підлість","підлий","огидний","огида","потворний","дефект","брак","зіпсований",
"зламаний","несправність","аварія","фатальний","смертельний","вірус","епідемія","наркотики","алкоголь",
"залежність","тінь","похмурість","зневіра","відчай","безвихідь","незгода","сварка","конфліктний","розбрат",
"ворожнеча","помста","мстивий","підступний","зрадницький","небезпека","ризикований","нестабільність","критичний",
"руйнівний","шкода","шкідливий","шкодити","вразливість","вразливий","безпорадність","безпорадний","пригніченість"
];

/* Позитивні слова: англійська. */
const POS_EN = [
"great","excellent","wonderful","fantastic","amazing","awesome","good","best","better","happy",
"happiness","joy","joyful","joyous","love","lovely","loving","success","successful","victory",
"win","winner","triumph","proud","pride","grateful","thanks","beautiful","beauty","pretty",
"nice","pleasant","perfect","ideal","brilliant","incredible","outstanding","remarkable","exceptional",
"positive","optimistic","hope","hopeful","inspiring","inspired","motivated","motivation","energy",
"energetic","strong","strength","powerful","power","peace","peaceful","calm","relaxing","comfortable",
"comfort","safe","safety","secure","health","healthy","wealthy","rich","luxury","generous",
"kind","kindness","care","caring","respect","honest","honesty","fair","justice","fun",
"funny","laugh","laughter","smile","cheerful","enjoy","delight","delightful","pleasure","dream",
"achieve","achievement","progress","growth","improve","improvement","innovation","creative","creativity",
"talent","talented","smart","wise","wisdom","freedom","free","adventure","discovery","miracle",
"magic","magical","blessing","blessed","fortune","lucky","luck","reward","gift","surprise",
"bright","sunshine","sunny","warm","warmth","gentle","sweet","charming","elegant","harmony",
"friendship","friend","friendly","support","supportive","helpful","useful","benefit","beneficial",
"effective","quality","premium","top","superior","marvelous","splendid","glorious","paradise",
"merry","festive","celebration","treasure","precious","valuable","congratulations","bravo","yay","thrive"
];

/* Негативні слова: англійська. */
const NEG_EN = [
"bad","terrible","horrible","awful","worst","worse","hate","hatred","hateful","angry",
"anger","furious","rage","sad","sadness","sorrow","grief","pain","painful","hurt",
"suffer","suffering","loss","lose","lost","fail","failure","defeat","loser","poor",
"poverty","ugly","disgust","disgusting","nasty","evil","cruel","cruelty","violent","violence",
"war","conflict","fight","fear","afraid","scared","scary","panic","anxious","anxiety",
"worry","worried","stress","stressful","depressed","depression","lonely","loneliness","boring","bored",
"tired","exhausted","sick","sickness","illness","ill","disease","death","dead","die",
"dying","kill","killing","murder","blood","wound","wounded","injury","injured","accident",
"disaster","catastrophe","tragic","tragedy","crisis","danger","dangerous","threat","threaten","risk",
"risky","error","mistake","wrong","problem","trouble","difficult","difficulty","hard","harsh",
"heavy","burden","obstacle","barrier","chaos","mess","messy","dirty","filth","poison",
"poisonous","toxic","pollution","destroy","destruction","ruin","ruined","damage","damaged","broken",
"break","crash","fire","flood","storm","hurricane","earthquake","drought","cold","freezing",
"darkness","dark","gloomy","shame","ashamed","guilt","guilty","blame","punish","punishment",
"crime","criminal","prison","jail","arrest","lie","liar","lying","deceit","deceive",
"cheat","cheating","fraud","scam","corrupt","corruption","unfair","injustice","betray","betrayal",
"jealous","jealousy","envy","greedy","greed","selfish","arrogant","stupid","dumb","idiot",
"foolish","fool","nonsense","useless","worthless","waste","trash","garbage","rotten","decay",
"nightmare","horror","dreadful","appalling","miserable","misery","unhappy","unpleasant","hopeless","despair",
"desperate","helpless","weak","weakness","fragile","vulnerable","defect","defective","flaw","flawed",
"malfunction","faulty","grim","bleak","somber"
];

const POS = new Set(POS_UK.concat(POS_EN));
const NEG = new Set(NEG_UK.concat(NEG_EN));

/* Заперечення: інвертують полярність слова, якщо стоять у вікні 2 слова перед ним. */
const NEGATORS = new Set(["не","ні","ані","без","not","no","never","n't"]);
/* Підсилювачі: множать вагу полярного слова на 1.5. */
const INTENSIFIERS = new Set(["дуже","дуже","very","extremely","incredibly","надзвичайно"]);

/* Токенізація: нижній регістр, лише літери/цифри, усі слова (включно з короткими,
   бо "не"/"ні"/"no"/"not" важливі для заперечень). */
function tokens(text){
  return String(text||"").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu," ")
    .split(" ")
    .map(w=>w.trim())
    .filter(w=>w.length>0);
}

/* sentiment(text) → {label: "positive"|"negative"|"neutral", score: -1..1} */
function sentiment(text){
  const t = String(text||"");
  if(!t.trim()) return {label:"neutral", score:0};
  const ws = tokens(t);
  let pos = 0, neg = 0;
  const hasExclaim = t.indexOf("!") !== -1;
  for(let i=0;i<ws.length;i++){
    const w = ws[i];
    let pol = 0;
    if(POS.has(w)) pol = 1;
    else if(NEG.has(w)) pol = -1;
    if(pol === 0) continue;
    /* Заперечення у вікні 2 слова перед словом інвертує полярність. */
    for(let j=Math.max(0,i-2); j<i; j++){
      if(NEGATORS.has(ws[j])){ pol = -pol; break; }
    }
    /* Підсилювачі: слово-підсилювач у вікні 2 слова → ×1.5; знак оклику → ×1.5. */
    let mult = 1;
    for(let j=Math.max(0,i-2); j<i; j++){
      if(INTENSIFIERS.has(ws[j])){ mult *= 1.5; break; }
    }
    if(hasExclaim) mult *= 1.5;
    if(pol > 0) pos += mult; else neg += mult;
  }
  const score = (pos-neg)/(pos+neg+1);
  const label = score > 0.15 ? "positive" : (score < -0.15 ? "negative" : "neutral");
  return {label: label, score: +score.toFixed(3)};
}

module.exports = {
  name: "16-sentiment",
  description: "Аналіз тональності тексту: українські та англійські словники полярних слів, заперечення й підсилювачі. Повертає label (positive/negative/neutral) та score (-1..1).",
  functions: { sentiment: sentiment }
};

return module.exports;})();
/* --- #17: readability --- */
const __imp17=(function(){var module={exports:{}};
/* Агент 17 — оцінка читабельності.
   Адаптація формули Флеша для слов'янських мов:
   score = 206.835 − 1.3×(середня довжина речення в словах)
                   − 60×(середня довжина слова в складах).
   Склади наближено = кількість голосних у слові (українська + російська + англійська).
   Чистий JS, zero dependencies, самодостатній модуль. */
"use strict";

/* Голосні: uk (а е є и і ї о у ю я) + ru (ы э ё) + en (a e i o u y). */
const VOWELS = new Set("аеєиіїоуюяїєюыэёaeiouy".split(""));

/* Розбиття на речення (логіка узгоджена з BridgeCore.splitSentences). */
function splitSentences(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?…])\s+(?=[А-ЯA-ZІЇЄҐЁ])/u)
    .map(s => s.trim())
    .filter(s => s.length > 1);
}

/* Слова: послідовності літер (unicode). */
function wordsOf(s) {
  return s.match(/[\p{L}]+/gu) || [];
}

/* Кількість складів у слові ≈ кількість голосних; мінімум 1. */
function countSyllables(word) {
  const low = word.toLowerCase();
  let n = 0;
  for (const ch of low) {
    if (VOWELS.has(ch)) n++;
  }
  return n > 0 ? n : 1;
}

/* Оцінка читабельності тексту.
   Повертає {score: number 0..100, level: string} або
   {score: null, level: "недостатньо даних"} для текстів < 3 речень.
   Безпечно працює з порожнім рядком / null — винятків не кидає. */
function readability(text) {
  const sentences = splitSentences(text);
  if (sentences.length < 3) {
    return { score: null, level: "недостатньо даних" };
  }
  const words = [];
  for (const s of sentences) words.push(...wordsOf(s));
  if (!words.length) {
    return { score: null, level: "недостатньо даних" };
  }
  const avgWordsPerSentence = words.length / sentences.length;
  const avgSyllablesPerWord =
    words.reduce((sum, w) => sum + countSyllables(w), 0) / words.length;
  let score =
    206.835 - 1.3 * avgWordsPerSentence - 60 * avgSyllablesPerWord;
  /* Обмежити діапазон 0..100 і округлити до десятих. */
  score = Math.max(0, Math.min(100, Math.round(score * 10) / 10));
  const level =
    score >= 80 ? "дуже легко" :
    score >= 60 ? "легко" :
    score >= 40 ? "середньо" :
    score >= 20 ? "складно" : "дуже складно";
  return { score, level };
}

module.exports = {
  name: "17-readability",
  description:
    "Оцінка читабельності тексту: адаптована формула Флеша для слов'янських мов " +
    "(середня довжина речення в словах, середня довжина слова в складах ≈ голосні). " +
    "Рівень: дуже легко / легко / середньо / складно / дуже складно; " +
    "для текстів менше 3 речень — «недостатньо даних».",
  functions: { readability }
};

return module.exports;})();
/* --- #18: vocabularyRichness --- */
const __imp18=(function(){var module={exports:{}};
/* Agent 18 — vocabularyRichness.
   Багатство словника: type-token ratio (TTR) та індекс Guiraud.
   Самодостатній модуль: власна токенізація, власний базовий набір стоп-слів.
   Чистий JS, zero dependencies, без мережевих викликів. */
"use strict";

/* Власний базовий набір стоп-слів: uk / en / ru. */
const STOP = new Set([
  // Українські
  "а","але","бо","був","була","були","було","буде","будуть","бути","в","вас","весь","від","він",
  "вона","вони","воно","все","всіх","ви","для","до","де","ж","же","з","за","й","його","її","їх",
  "і","із","чи","як","яка","який","які","яку","мене","мені","ми","на","над","нас","не","немає",
  "ні","о","об","ось","під","по","про","с","свій","своя","свої","так","таки","там","те","ти","то",
  "тобто","тоді","тільки","у","це","цей","ця","ці","цю","що","щоб","я","йому","тебе","нього","неї",
  "коли","якщо","або","надто","вже","ще","також","між","через","при","без","кожен","кожна","інший",
  "інша","саме","лише","навіть","дуже","більше","менше","можна","треба","є","нема","от","он",
  // Англійські
  "the","a","an","and","or","but","if","then","else","when","at","by","for","with","about","into",
  "through","during","before","after","above","below","to","from","up","down","in","out","on","off",
  "over","under","again","further","once","here","there","all","any","both","each","few","more",
  "most","other","some","such","no","nor","not","only","own","same","so","than","too","very","can",
  "will","just","should","now","is","are","was","were","be","been","being","have","has","had",
  "having","do","does","did","doing","would","could","ought","i","you","he","she","it","we","they",
  "them","their","this","that","these","those","am","as","of","its","my","your","his","her","our",
  // Російські
  "а","но","или","если","то","тогда","так","также","вот","вон","это","эта","эти","этот","к","ко",
  "в","во","на","над","под","о","об","от","до","для","при","без","через","между","из","у","с","со",
  "не","ни","нет","да","же","ж","ли","бы","б","ведь","там","тут","здесь","как","какой","какая",
  "какие","который","которая","которые","что","чтобы","кто","меня","мне","мы","нас","вы","вас",
  "он","она","они","его","ее","их","тебя","себя","мой","моя","мое","мои","твой","твоя","свой",
  "своя","наш","ваш","весь","вся","все","каждый","другой","сам","сама","уже","еще","только","лишь",
  "даже","очень","более","менее","можно","нужно","есть","быть","был","была","были","было","будет",
  "будут","него","нее","когда"
]);

/* Токенізація: нижній регістр, лише літери, без стоп-слів, довжина > 2. */
function tokenize(text) {
  return String(text || "").toLowerCase()
    .replace(/[^\p{L}]+/gu, " ")
    .split(" ")
    .map(w => w.trim())
    .filter(w => w.length > 2 && !STOP.has(w));
}

/* Багатство словника тексту.
   ttr = unique/total (0..1), guiraud = unique / sqrt(total). */
function vocabularyRichness(text) {
  const tokens = tokenize(text);
  const total = tokens.length;
  if (total === 0) {
    return { ttr: 0, guiraud: 0, unique: 0, total: 0 };
  }
  const unique = new Set(tokens).size;
  return {
    ttr: unique / total,
    guiraud: unique / Math.sqrt(total),
    unique,
    total
  };
}

module.exports = {
  name: "18-vocabulary-richness",
  description: "Багатство словника: type-token ratio (TTR) та індекс Guiraud для тексту.",
  functions: { vocabularyRichness }
};

return module.exports;})();
/* --- #19: detectTopics --- */
const __imp19=(function(){var module={exports:{}};
/* improvement_19.js — агент 19: виявлення тем (кластеризація речень).
   Жадібна кластеризація: топ-слова за частотою стають центроїдами тем,
   кожне речення відноситься до теми з максимальним перетином ключових слів.
   Чистий JS, zero dependencies, детерміновано. */

/* Компактний набір стоп-слів (uk / en / ru). */
const STOP=new Set(("а,але,бо,був,була,були,було,буде,будуть,в,вас,весь,від,він,вона,вони,воно,все,всіх,ви,для,до,де,ж,же,з,за,й,його,її,їх,і,із,чи,як,яка,який,які,яку,мене,мені,ми,на,над,нас,не,немає,ні,о,об,ось,під,по,про,с,свій,своя,свої,так,таки,там,те,ти,то,тобто,тоді,тільки,у,це,цей,ця,ці,цю,що,щоб,я,йому,тебе,нього,неї,коли,якщо,або,надто,вже,ще,також,між,через,при,без,кожен,кожна,інший,інша,саме,лише,навіть,дуже,більше,менше,можна,треба,бути,є,нема,от"+
",the,a,an,and,or,but,if,then,else,when,at,by,for,with,about,into,through,during,before,after,above,below,to,from,up,down,in,out,on,off,over,under,again,further,once,here,there,all,any,both,each,few,more,most,other,some,such,no,nor,not,only,own,same,so,than,too,very,can,will,just,should,now,is,are,was,were,be,been,being,have,has,had,having,do,does,did,doing,would,could,ought,i,you,he,she,it,we,they,them,their,this,that,these,those,am,as,of,its,my,your,his,her,our"+
",но,или,если,то,тогда,так,также,вот,вон,это,эта,эти,этот,к,ко,во,о,об,от,до,для,при,без,через,между,из,у,со,не,ни,нет,да,же,ли,бы,ведь,там,тут,здесь,как,какой,какая,какие,который,которая,которые,что,чтобы,кто,меня,мне,мы,нас,вы,вас,он,она,они,его,ее,их,тебя,себя,мой,моя,мое,мои,твой,твоя,свой,своя,наш,ваш,весь,вся,все,каждый,другой,сам,сама,уже,еще,только,лишь,даже,очень,более,менее,можно,нужно,есть,быть,был,была,были,было,будет,будут,него,нее,когда").split(","));

/* Розбити текст на речення. */
function splitSentences(text){
  return String(text||"")
    .replace(/\s+/g," ")
    .split(/(?<=[.!?…])\s+(?=[А-ЯA-ZІЇЄҐЁ])/u)
    .map(s=>s.trim())
    .filter(s=>s.length>1);
}

/* Токенізація: літери, нижній регістр, без стоп-слів і цифр, довжина>2. */
function tokenize(text){
  return String(text||"").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu," ")
    .split(" ")
    .map(w=>w.trim())
    .filter(w=>w.length>2&&!STOP.has(w)&&!/\d/.test(w));
}

/* Частота слів. */
function wordFreq(tokens){
  const m=new Map();
  for(const w of tokens)m.set(w,(m.get(w)||0)+1);
  return m;
}

/* Грубе порівняння за спільним префіксом ≥5 (слов'янська морфологія). */
function stemMatch(a,b){
  if(a===b)return true;
  if(a.length<5||b.length<5)return false;
  let i=0;const n=Math.min(a.length,b.length);
  while(i<n&&a[i]===b[i])i++;
  return i>=5;
}

/* Топ-N слів за частотою (детермінований тай-брейк — алфавітний). */
function topWords(freq,n){
  return[...freq.entries()]
    .sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))
    .slice(0,n)
    .map(([w])=>w);
}

/* Виявити теми: жадібна кластеризація речень.
   text — вхідний текст; k — бажана к-сть тем (1..5, за замовчуванням 3).
   Повертає [{keywords: string[], sentences: string[]}]:
   - топ-слова тексту за частотою = центроїди (затравки) тем;
   - кожне речення → тема з макс. перетином (stemMatch) з центроїдом;
   - keywords теми = топ-5 слів кластера; sentences — у вихідному порядку;
   - порожні кластери відкидаються.
   Порожній/некоректний вхід → []. */
function detectTopics(text,k){
  if(k==null)k=3;
  k=Math.max(1,Math.min(5,Math.floor(Number(k)||3)));

  const sentences=splitSentences(text);
  if(!sentences.length)return[];

  const sentTokens=sentences.map(s=>tokenize(s));
  const globalFreq=wordFreq(sentTokens.flat());

  /* Центроїди: топ-k слів за частотою. */
  const centroids=topWords(globalFreq,k);
  if(!centroids.length)return[];

  /* Віднести кожне речення до центроїда з макс. перетином.
     Тай-брейк — менший індекс центроїда (детерміновано).
     Нульовий перетин усюди → перший центроїд. */
  const buckets=centroids.map(()=>[]);
  sentTokens.forEach((toks,si)=>{
    let best=0,bestScore=-1;
    for(let ci=0;ci<centroids.length;ci++){
      const c=centroids[ci];
      let score=0;
      for(const w of toks)if(stemMatch(w,c))score++;
      if(score>bestScore){bestScore=score;best=ci;}
    }
    buckets[best].push(si);
  });

  /* Зібрати теми: топ-5 слів кластера + речення у вихідному порядку. */
  const topics=[];
  buckets.forEach(idxs=>{
    if(!idxs.length)return; /* порожній кластер відкидаємо */
    const clusterTokens=idxs.flatMap(si=>sentTokens[si]);
    const clusterFreq=wordFreq(clusterTokens);
    /* Тай-брейк топ-слів кластера: спочатку глобальна частота, потім алфавіт. */
    const keywords=[...clusterFreq.entries()]
      .sort((a,b)=>b[1]-a[1]||(globalFreq.get(b[0])||0)-(globalFreq.get(a[0])||0)||a[0].localeCompare(b[0]))
      .slice(0,5)
      .map(([w])=>w);
    topics.push({
      keywords,
      sentences:idxs.map(si=>sentences[si])
    });
  });
  return topics;
}

module.exports={
  name:"19-topic-clustering",
  description:"Виявлення тем тексту жадібною кластеризацією речень: топ-слова за частотою стають центроїдами, речення відносяться до теми з максимальним перетином ключових слів.",
  functions:{detectTopics}
};

return module.exports;})();
/* --- #20: classifyText --- */
const __imp20=(function(){var module={exports:{}};
/* improvement_20 — класифікація типу тексту (news | instruction | opinion | other).
   Маркерний підрахунок: news (дати, "повідомляється", "заявив", числа/дати),
   instruction (нумеровані кроки, наказовий спосіб, "крок"/"step", "спочатку"/"first"),
   opinion ("я вважаю", "на мою думку", оціночні прикметники).
   Чистий JS, zero dependencies. Коментарі українською. */
"use strict";

/* Маркери для кожного типу. */
const MARKERS = {
  news: [
    "повідомляється", "повідомляють", "повідомив", "повідомила", "повідомили",
    "заявив", "заявила", "заявили", "оголосив", "оголосила", "оголосили",
    "підтвердив", "підтвердила", "підтвердили", "сказав", "сказала", "сказали",
    "за інформацією", "за словами", "сьогодні", "вчора", "завтра",
    "reported", "announced", "confirmed", "stated", "said", "according to",
    "today", "yesterday", "breaking", "headline", "згідно з джерелами"
  ],
  instruction: [
    "крок", "спочатку", "потім", "далі", "наприкінці",
    "натисніть", "натиснути", "зробіть", "зробити", "перейдіть", "перейти",
    "введіть", "ввести", "оберіть", "обрати", "відкрийте", "відкрити",
    "закрийте", "закрити", "збережіть", "зберегти", "виконайте", "виконати",
    "повторіть", "повторити", "перевірте", "перевірити",
    "step", "first", "then", "next", "finally",
    "click", "press", "open", "close", "save", "repeat", "check", "make sure"
  ],
  opinion: [
    "я вважаю", "на мою думку", "мені здається", "як на мене",
    "я думаю", "моя думка", "на мій погляд", "особисто я",
    "i think", "in my opinion", "i believe", "in my view", "personally",
    "чудовий", "жахливий", "прекрасний", "прекрасна", "прекрасне",
    "цікавий", "нудний", "кращий", "гірший", "найкращий", "найгірший",
    "дивовижний", "вражаючий", "сумнівний", "жахливо", "чудово", "прекрасно",
    "amazing", "terrible", "great", "awful", "boring", "beautiful",
    "interesting", "worst", "best", "fantastic", "horrible"
  ]
};

/* Вагові формати: нумеровані кроки та дати/числа. */
const NUMBERED_STEP_RE = /(?:^|\n|\s)\d{1,2}[.)]\s+\S/g;      // "1. Текст", "2) Текст"
const DATE_RE = /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|\b(19|20)\d{2}\b|\b\d{1,2}\s?(січня|лютого|березня|квітня|травня|червня|липня|серпня|вересня|жовтня|листопада|грудня|року|р\.?)/g;

/* Екранування спецсимволів для regex. */
function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* Підрахунок входжень маркера (case-insensitive, Unicode-межі слова). */
function countOccurrences(text, marker) {
  const re = new RegExp("(?<![\\p{L}\\p{N}_])" + esc(marker) + "(?![\\p{L}\\p{N}_])", "giu");
  let n = 0;
  while (re.exec(text) !== null) n++;
  return n;
}

/* Класифікація тексту за маркерними рахунками. */
function classifyText(text) {
  const t = String(text || "");
  if (!t.trim()) return { type: "other", confidence: 0 };

  const low = t.toLowerCase();
  const scores = { news: 0, instruction: 0, opinion: 0 };

  for (const type of Object.keys(MARKERS)) {
    for (const m of MARKERS[type]) {
      scores[type] += countOccurrences(low, m);
    }
  }

  /* Нумеровані кроки — маркер інструкції. */
  let steps = 0;
  const stepRe = new RegExp(NUMBERED_STEP_RE.source, NUMBERED_STEP_RE.flags);
  while (stepRe.exec(t) !== null) steps++;
  scores.instruction += steps * 2;

  /* Дати та роки — маркер новини. */
  let dates = 0;
  const dateRe = new RegExp(DATE_RE.source, DATE_RE.flags);
  while (dateRe.exec(low) !== null) dates++;
  scores.news += dates * 2;

  const total = scores.news + scores.instruction + scores.opinion;
  if (total === 0) return { type: "other", confidence: 0 };

  /* Тип з максимальним рахунком; пріоритет при нічиї: news > instruction > opinion. */
  const order = ["news", "instruction", "opinion"];
  let best = order[0];
  for (const type of order) {
    if (scores[type] > scores[best]) best = type;
  }
  return { type: best, confidence: +(scores[best] / total).toFixed(3) };
}

module.exports = {
  name: "text-type-classifier",
  description: "Класифікує текст на типи news / instruction / opinion / other за маркерним підрахунком з рівнем впевненості.",
  functions: { classifyText }
};

return module.exports;})();
/* --- #21: keyPhrases --- */
const __imp21=(function(){var module={exports:{}};
/* improvement_21 — ключові фрази (біграми/триграми) для BridgeCore.
   Агент 21. Чистий JS, zero dependencies, без мережевих викликів.
   keyPhrases(text, n) -> [{phrase, count}]
   - токени: нижній регістр, власний базовий набір стоп-слів (uk/en);
   - будуються біграми (2) і триграми (3) з сусідніх токенів;
   - відсікаються фрази, що ПОЧИНАЮТЬСЯ або ЗАКІНЧУЮТЬСЯ стоп-словом
     (стоп-слово всередині фрази допускається);
   - частота >= 2, сортування за count за спаданням, топ-n
     (за замовчуванням 10, мінімум 1, максимум 30);
   - порожній вхід -> [], винятків не кидає, детерміновано. */
"use strict";

/* Власний базовий набір стоп-слів: українська + англійська. */
const STOP = new Set((
  "і,та,але,або,що,як,це,той,така,такий,в,у,на,з,до,по,від,за,для,про,при," +
  "без,через,між,над,під,не,ні,також,вже,ще,дуже,більше,менше,лише,тільки," +
  "можна,треба,буде,був,була,були,було,є,бути,я,ти,він,вона,воно,ми,ви,вони," +
  "мене,тебе,його,її,нас,вас,їх,себе,мій,моя,моє,мої,твій,свій,наш,ваш," +
  "цей,ця,ці,та,те,ті,який,яка,яке,які,коли,де,хто,чого,чи,а,ж,же,б,би," +
  "ось,там,тут,так,то,тоді,якщо,тому,поки,щоб,зі,із,об,о,с,кожен,кожна," +
  "інший,інша,все,всі,сам,сама,саме,навіть,от,он,бо,адже,йому,нього,неї,їм"
).split(",").concat((
  "the,a,an,and,or,but,if,then,else,when,at,by,for,with,about,into,through," +
  "during,before,after,above,below,to,from,up,down,in,out,on,off,over,under," +
  "again,further,once,here,there,all,any,both,each,few,more,most,other,some," +
  "such,no,nor,not,only,own,same,so,than,too,very,can,will,just,should,now," +
  "is,are,was,were,be,been,being,have,has,had,having,do,does,did,doing," +
  "would,could,ought,i,you,he,she,it,we,they,them,their,this,that,these," +
  "those,am,as,of,its,my,your,his,her,our"
).split(",")));

/* Токенізація: літери/цифри (unicode), нижній регістр.
   Стоп-слова ТУТ не прибираємо — вони потрібні для фільтра меж фраз. */
function tokenizePhrases(text) {
  return String(text || "").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .map(w => w.trim())
    .filter(w => w.length >= 2 && !/\d/.test(w));
}

/* Ключові фрази: біграми + триграми з частотою >= 2. */
function keyPhrases(text, n) {
  n = Math.max(1, Math.min(30, n || 10));
  const tokens = tokenizePhrases(text);
  if (tokens.length < 2) return [];

  const counts = new Map();
  for (const size of [2, 3]) {
    for (let i = 0; i + size <= tokens.length; i++) {
      const gram = tokens.slice(i, i + size);
      /* Відсікаємо фрази, що починаються або закінчуються стоп-словом. */
      if (STOP.has(gram[0]) || STOP.has(gram[gram.length - 1])) continue;
      const phrase = gram.join(" ");
      counts.set(phrase, (counts.get(phrase) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([phrase, count]) => ({ phrase, count }));
}

module.exports = {
  name: "21-key-phrases",
  description: "Ключові фрази тексту: біграми і триграми з частотою ≥2, без стоп-слів на межах фрази.",
  functions: { keyPhrases }
};

return module.exports;})();
/* --- #22: collocations --- */
const __imp22=(function(){var module={exports:{}};
/* BridgeCore improvement #22 — колокації (стійкі сполучення) за PMI.
   Чистий JavaScript, zero dependencies, без мережі. Самодостатній модуль. */
"use strict";

/* Власний базовий набір стоп-слів: uk / en / ru. */
const STOP_WORDS = new Set((
  "а,але,бо,був,була,були,було,буде,в,вас,весь,від,він,вона,вони,воно,все,ви,для,до,де,ж,же,з,за,й,його,її,їх,і,із,чи,як,яка,який,які,яку,мене,мені,ми,на,над,нас,не,немає,ні,о,об,ось,під,по,про,с,свій,своя,своє,так,там,те,ти,то,тобто,тоді,тільки,у,це,цей,ця,ці,цю,що,щоб,я,йому,тебе,коли,якщо,або,надто,вже,ще,також,між,через,при,без,кожен,інший,саме,лише,навіть,дуже,більше,менше,можна,треба,бути,є,нема," +
  "the,a,an,and,or,but,if,then,else,when,at,by,for,with,about,into,through,during,before,after,above,below,to,from,up,down,in,out,on,off,over,under,again,further,once,here,there,all,any,both,each,few,more,most,other,some,such,no,nor,not,only,own,same,so,than,too,very,can,will,just,should,now,is,are,was,were,be,been,being,have,has,had,having,do,does,did,doing,would,could,i,you,he,she,it,we,they,them,their,this,that,these,those,am,as,of,its,my,your,his,her,our," +
  "а,но,или,если,то,тогда,так,также,вот,это,эта,эти,этот,к,ко,в,во,на,над,под,о,об,от,до,для,при,без,через,между,из,у,с,со,не,ни,нет,да,же,ж,ли,бы,ведь,там,тут,здесь,как,какой,какая,какие,который,что,чтобы,кто,меня,мне,мы,нас,вы,вас,он,она,они,его,ее,их,тебя,себя,мой,моя,мое,мои,твой,своя,наш,ваш,весь,вся,все,каждый,другой,сам,сама,уже,еще,только,лишь,даже,очень,более,менее,можно,нужно,есть,быть,был,была,были,было,будет,когда,или"
).split(","));

/* Токенізація: нижній регістр, unicode-літери/цифри, без стоп-слів і цифр. */
function tokenize(text) {
  return String(text || "").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .map(w => w.trim())
    .filter(w => w.length > 2 && !STOP_WORDS.has(w) && !/\d/.test(w));
}

/* PMI(w1,w2) = log2( P(w1,w2) / (P(w1)*P(w2)) ).
   Біграми з частотою ≥ 3, без стоп-слів. Сортування pmi desc, топ-n (за замовч. 10). */
function collocations(text, n) {
  n = (n == null || !(n > 0)) ? 10 : Math.floor(n);
  const tokens = tokenize(text);
  if (tokens.length < 2) return [];

  /* Частоти слів. */
  const wordCount = new Map();
  for (const w of tokens) wordCount.set(w, (wordCount.get(w) || 0) + 1);
  const totalWords = tokens.length;

  /* Частоти біграм (суміжних пар токенів). */
  const bigramCount = new Map();
  for (let i = 0; i < tokens.length - 1; i++) {
    const key = tokens[i] + "\u0000" + tokens[i + 1];
    bigramCount.set(key, (bigramCount.get(key) || 0) + 1);
  }
  const totalBigrams = tokens.length - 1;

  const result = [];
  for (const [key, c] of bigramCount) {
    if (c < 3) continue; /* поріг частоти */
    const [w1, w2] = key.split("\u0000");
    /* Стоп-слова вже відсіяні токенізацією; додаткова перевірка на всяк випадок. */
    if (STOP_WORDS.has(w1) || STOP_WORDS.has(w2)) continue;
    const p12 = c / totalBigrams;
    const p1 = wordCount.get(w1) / totalWords;
    const p2 = wordCount.get(w2) / totalWords;
    const pmi = Math.log2(p12 / (p1 * p2));
    if (!isFinite(pmi)) continue;
    result.push({ phrase: w1 + " " + w2, pmi });
  }

  result.sort((a, b) => b.pmi - a.pmi || a.phrase.localeCompare(b.phrase));
  return result.slice(0, n);
}

module.exports = {
  name: "22-collocations-pmi",
  description: "Знаходить стійкі сполучення слів (колокації) у тексті за поточковою взаємною інформацією PMI: біграми з частотою ≥3, без стоп-слів, сортовані за PMI спадання.",
  functions: { collocations }
};

return module.exports;})();
/* --- #23: keywordsTFIDF --- */
const __imp23=(function(){var module={exports:{}};
/* Agent 23 — TF-IDF зважування ключових слів.
   Самодостатній модуль: чистий JS, zero dependencies, без мережі.
   keywordsTFIDF(text, n, corpus):
     - text   — вхідний текст (string)
     - n      — топ-N, за замовчуванням 10, максимум 30
     - corpus — опціональний масив документів-рядків; якщо задано,
                IDF рахується по корпусу, інакше — по реченнях тексту
   Формула: tf = частота слова / всього токенів; idf = log(1 + D/df). */
"use strict";

/* Базовий набір стоп-слів uk/en (мінімальний, практичний). */
const STOP = new Set((
  "а,але,бо,був,була,були,було,буде,будуть,в,вас,весь,від,він,вона,вони,воно," +
  "все,всіх,ви,для,до,де,ж,же,з,за,й,його,її,їх,і,із,чи,як,яка,який,які,яку," +
  "мене,мені,ми,на,над,нас,не,немає,ні,о,об,ось,під,по,про,с,свій,своя,свої," +
  "так,таки,там,те,ти,то,тобто,тоді,тільки,у,це,цей,ця,ці,цю,що,щоб,я,йому," +
  "тебе,нього,неї,коли,якщо,або,надто,вже,ще,також,між,через,при,без,кожен," +
  "кожна,інший,інша,саме,лише,навіть,дуже,більше,менше,можна,треба,бути,є," +
  "нема,от,он" +
  ",the,a,an,and,or,but,if,then,else,when,at,by,for,with,about,into,through," +
  "during,before,after,above,below,to,from,up,down,in,out,on,off,over,under," +
  "again,further,once,here,there,all,any,both,each,few,more,most,other,some," +
  "such,no,nor,not,only,own,same,so,than,too,very,can,will,just,should,now," +
  "is,are,was,were,be,been,being,have,has,had,having,do,does,did,doing," +
  "would,could,ought,i,you,he,she,it,we,they,them,their,this,that,these," +
  "those,am,as,of,its,my,your,his,her,our"
).split(","));

/* Токенізація: літери unicode, нижній регістр, без стоп-слів і цифр, довжина > 2. */
function tokenize(text) {
  return String(text || "").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .map(w => w.trim())
    .filter(w => w.length > 2 && !STOP.has(w) && !/\d/.test(w));
}

/* Розбиття на речення (копія логіки core.js, самодостатньо). */
function splitSentences(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?…])\s+(?=[А-ЯA-ZІЇЄҐЁ])/u)
    .map(s => s.trim())
    .filter(s => s.length > 1);
}

/* TF-IDF зважування ключових слів.
   corpus: якщо непорожній масив — IDF по корпусу (сам текст до D не входить,
   df рахується лише по документах корпусу, мінімум 1 щоб не ділити на нуль);
   інакше — IDF по реченнях вхідного тексту.
   Повертає масив [{word, tfidf}], відсортований за tfidf спаданням. */
function keywordsTFIDF(text, n, corpus) {
  n = Math.max(1, Math.min(30, n || 10));
  const tokens = tokenize(text);
  if (!tokens.length) return [];

  /* tf: частота слова / всього токенів. */
  const tfMap = new Map();
  for (const w of tokens) tfMap.set(w, (tfMap.get(w) || 0) + 1);
  const total = tokens.length;

  /* Документи для IDF: корпус або речення тексту. */
  let docs;
  if (Array.isArray(corpus) && corpus.length) {
    docs = corpus.map(d => new Set(tokenize(d)));
  } else {
    docs = splitSentences(text).map(s => new Set(tokenize(s)));
    if (!docs.length) docs = [new Set(tokens)]; /* одне речення-запасний варіант */
  }
  const D = docs.length;

  /* df: кількість документів, що містять слово. */
  const dfMap = new Map();
  for (const doc of docs) {
    for (const w of doc) {
      if (tfMap.has(w)) dfMap.set(w, (dfMap.get(w) || 0) + 1);
    }
  }

  const result = [];
  for (const [word, count] of tfMap.entries()) {
    const tf = count / total;
    const df = Math.max(1, dfMap.get(word) || 0); /* захист від ділення на нуль */
    const idf = Math.log(1 + D / df);
    result.push({ word, tfidf: +(tf * idf).toFixed(4) });
  }

  return result
    .sort((a, b) => b.tfidf - a.tfidf || a.word.localeCompare(b.word))
    .slice(0, n);
}

module.exports = {
  name: "23-tfidf-keywords",
  description: "TF-IDF зважування ключових слів: унікальні для документа слова отримують вищу вагу, ніж загальні. IDF рахується по переданому корпусу або по реченнях тексту.",
  functions: { keywordsTFIDF }
};

return module.exports;})();
/* --- #24: detectHeadings --- */
const __imp24=(function(){var module={exports:{}};
/* AI Bridge Core — покращення 24: детекція заголовків.
   Чистий JavaScript, zero dependencies, без мережевих викликів.
   Працює самодостатньо (BridgeCore не потрібен). */

"use strict";

/* Обчислити частку великих літер серед літер рядка. */
function capsRatio(line) {
  const letters = line.match(/\p{L}/gu) || [];
  if (!letters.length) return 0;
  const upper = letters.filter(ch => /\p{Lu}/u.test(ch)).length;
  return upper / letters.length;
}

/* Визначити, чи рядок є КАПС-заголовком:
   довжина 3..80 символів і ≥70% літер — великі. */
function isCapsHeading(line) {
  const t = line.trim();
  if (t.length < 3 || t.length > 80) return false;
  if (!/\p{L}/u.test(t)) return false;
  return capsRatio(t) >= 0.7;
}

/* Детекція заголовків у тексті.
   Повертає [{level, text}] у порядку появи в тексті.
   Пріоритет збігів на одному рядку: Markdown > КАПС > нумеровані > короткі рядки. */
function detectHeadings(text) {
  if (text === null || text === undefined) return [];
  const t = String(text);
  if (!t.trim()) return [];

  const lines = t.split(/\r?\n/);
  const used = new Array(lines.length).fill(false);
  const found = []; // {idx, level, text}

  const push = (idx, level, headingText) => {
    if (used[idx]) return;
    const clean = String(headingText).trim();
    if (!clean) return;
    used[idx] = true;
    found.push({ idx, level, text: clean });
  };

  // Прохід 1: Markdown-заголовки (#, ##, ###).
  lines.forEach((line, i) => {
    const m = line.match(/^\s*(#{1,3})\s+(.+?)\s*$/);
    if (m) {
      // Прибираємо можливі закриваючі # (напр. "## Заг ##").
      const clean = m[2].replace(/\s+#+\s*$/, "").trim();
      push(i, m[1].length, clean);
    }
  });

  // Прохід 2: КАПС-рядки → level 1.
  lines.forEach((line, i) => {
    if (used[i]) return;
    if (isCapsHeading(line)) push(i, 1, line.trim());
  });

  // Прохід 3: нумеровані "1. Заголовок" на окремому рядку → level 2.
  lines.forEach((line, i) => {
    if (used[i]) return;
    const m = line.trim().match(/^(\d+)[.)]\s+(.+)$/);
    if (m && m[2].trim().length >= 3) push(i, 2, m[2].trim());
  });

  // Прохід 4: короткі рядки (<60 символів), після яких порожній рядок → level 2.
  lines.forEach((line, i) => {
    if (used[i]) return;
    const cur = line.trim();
    if (!cur || cur.length >= 60) return;
    const next = lines[i + 1];
    if (next !== undefined && next.trim() === "") push(i, 2, cur);
  });

  return found
    .sort((a, b) => a.idx - b.idx)
    .map(({ level, text }) => ({ level, text }));
}

module.exports = {
  name: "24-heading-detection",
  description: "Детекція заголовків у тексті: Markdown (#/##/###), КАПС-рядки, короткі рядки перед порожнім рядком, нумеровані заголовки. Повертає список {level, text} у порядку появи.",
  functions: { detectHeadings }
};

return module.exports;})();
/* --- #25: detectLists --- */
const __imp25=(function(){var module={exports:{}};
/* improvement_25.js — детекція списків у тексті.
   Агент 25. Чистий JS, zero dependencies, без мережевих викликів. */
"use strict";

/* Маркер невпорядкованого списку: -, *, •, + на початку рядка
   (після нього — пробіл(и) і непорожній текст пункту). */
const UNORDERED_RE = /^\s*[-*•+]\s+(\S.*)$/u;

/* Маркер впорядкованого списку:
   - "1." / "1)" — 1–3 цифри (обмеження відсікає роки типу "2026.");
   - "а)" — одна літера (кирилиця/латиниця, будь-який регістр);
   - "(1)" — цифри в дужках. */
const ORDERED_RE = /^\s*(?:\d{1,3}[.)]|\p{L}\)|\(\d{1,3}\))\s+(\S.*)$/u;

/* detectLists(text) → [{type: "ordered"|"unordered", items: string[]}]
   Послідовні рядки одного типу групуються в один список.
   Порожній рядок або звичайний текст розривають поточний список.
   items — trim, без маркера. Порожній рядок/null → []. */
function detectLists(text){
  const lines = String(text == null ? "" : text).split(/\r?\n/);
  const lists = [];
  let current = null; /* {type, items} — список, що зараз накопичується */
  const flush = () => {
    if(current && current.items.length)lists.push({type: current.type, items: current.items});
    current = null;
  };
  for(const raw of lines){
    if(!raw.trim()){ flush(); continue; } /* порожній рядок розриває список */
    let type = null, item = null;
    const u = UNORDERED_RE.exec(raw);
    if(u){ type = "unordered"; item = u[1].trim(); }
    else{
      const o = ORDERED_RE.exec(raw);
      if(o){ type = "ordered"; item = o[1].trim(); }
    }
    if(!type || !item){ flush(); continue; } /* звичайний текст розриває список */
    if(!current || current.type !== type){
      flush();
      current = {type, items: []};
    }
    current.items.push(item);
  }
  flush();
  return lists;
}

module.exports = {
  name: "25-list-detection",
  description: "Детекція маркованих (-, *, •, +) і нумерованих (1., 1), а), (1)) списків: групує послідовні рядки одного типу в один список, повертає тип і очищені від маркерів пункти.",
  functions: { detectLists }
};

return module.exports;})();
/* --- #26: detectParagraphs --- */
const __imp26=(function(){var module={exports:{}};
/* Agent 26 — детекція абзаців і структури тексту.
   detectParagraphs(text) → {paragraphs, count, avgLength, structure}.
   Абзаци = блоки, розділені порожнім рядком (або 2+ переносами рядків).
   structure: "empty" (порожньо), "single" (1 абзац), "short" (2–3), "structured" (4+).
   avgLength: середня довжина абзацу в словах (заокруглено до 1 знака).
   Чистий JS, zero dependencies, без мережевих викликів. */

"use strict";

/* Підрахунок слів у рядку (без залежностей від BridgeCore). */
function countWords(s) {
  const t = String(s || "").trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}

/* Детекція абзаців і структури тексту. */
function detectParagraphs(text) {
  const t = String(text == null ? "" : text);
  if (!t.trim()) {
    return { paragraphs: [], count: 0, avgLength: 0, structure: "empty" };
  }
  // Нормалізуємо переноси рядків, потім ділимо по 2+ переносах (порожній рядок)
  // або по рядку, що містить лише пробіли між абзацами.
  const norm = t.replace(/\r\n?/g, "\n");
  const paragraphs = norm
    .split(/\n\s*\n|\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const count = paragraphs.length;
  if (count === 0) {
    return { paragraphs: [], count: 0, avgLength: 0, structure: "empty" };
  }
  const totalWords = paragraphs.reduce((sum, p) => sum + countWords(p), 0);
  const avgLength = +(totalWords / count).toFixed(1);

  let structure;
  if (count === 1) structure = "single";
  else if (count <= 3) structure = "short";
  else structure = "structured";

  return { paragraphs, count, avgLength, structure };
}

module.exports = {
  name: "26-paragraph-structure",
  description: "Детекція абзаців і структури тексту: розбиття на абзаци, підрахунок, середня довжина в словах, тип структури (empty/single/short/structured).",
  functions: { detectParagraphs }
};

return module.exports;})();
/* --- #27: extractTables --- */
const __imp27=(function(){var module={exports:{}};
/* Витяг таблиць з тексту — агент 27.
   Чистий JS, zero dependencies, без мережевих викликів. */

"use strict";

/* Розбити markdown-рядок "| a | b |" на комірки (обрізані). */
function splitPipeCells(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map(c => c.trim());
}

/* Рядок-роздільник markdown-таблиці: комірки виду ---, :---, ---:, :-:. */
function isMdSeparator(line) {
  const cells = splitPipeCells(line);
  if (cells.length < 1) return false;
  return cells.every(c => /^:?-+:?$/.test(c));
}

/* Чи може рядок бути рядком markdown-таблиці (має 2+ вертикальні риски). */
function isMdRow(line) {
  const pipes = (line.match(/\|/g) || []).length;
  return pipes >= 2 && /\S/.test(line);
}

/* Витяг markdown-таблиць з рядків. */
function extractMarkdownTables(lines) {
  const tables = [];
  const used = new Set();
  for (let i = 0; i < lines.length - 1; i++) {
    if (used.has(i)) continue;
    if (!isMdRow(lines[i])) continue;
    if (!isMdSeparator(lines[i + 1])) continue;
    const headers = splitPipeCells(lines[i]);
    const rows = [];
    let j = i + 2;
    while (j < lines.length && isMdRow(lines[j]) && !isMdSeparator(lines[j])) {
      const cells = splitPipeCells(lines[j]);
      rows.push(cells);
      j++;
    }
    /* Нормалізувати кількість комірок до ширини заголовка. */
    const n = headers.length;
    for (const r of rows) {
      while (r.length < n) r.push("");
      if (r.length > n) r.length = n;
    }
    tables.push({ headers, rows, _from: i, _to: j - 1 });
    for (let k = i; k < j; k++) used.add(k);
  }
  return { tables, used };
}

/* Розбити рядок на комірки по 2+ пробілах; повернути {cells, starts}. */
function splitSpaceCells(line) {
  const cells = [];
  const starts = [];
  const re = /\S(?:.*?\S)?(?=\s{2,}|\s*$)/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    cells.push(m[0].trim());
    starts.push(m.index);
  }
  return { cells, starts };
}

/* Чи має рядок ≥2 комірки, розділені 2+ пробілами (і не є markdown-рядком). */
function isSpaceRow(line) {
  if (line.includes("|")) return false;
  const { cells } = splitSpaceCells(line);
  return cells.length >= 2;
}

/* Чи мають два рядки однакову структуру: та сама кількість колонок
   і початки колонок близькі (допуск 2 символи). */
function sameStructure(a, b) {
  if (a.cells.length !== b.cells.length || a.cells.length < 2) return false;
  for (let i = 0; i < a.starts.length; i++) {
    if (Math.abs(a.starts[i] - b.starts[i]) > 2) return false;
  }
  return true;
}

/* Витяг таблиць, вирівняних пробілами: 3+ послідовні рядки однакової структури. */
function extractSpaceTables(lines, used) {
  const tables = [];
  let i = 0;
  while (i < lines.length) {
    if (used.has(i) || lines[i].trim() === "" || !isSpaceRow(lines[i])) { i++; continue; }
    const block = [splitSpaceCells(lines[i])];
    let j = i + 1;
    while (j < lines.length && !used.has(j) && lines[j].trim() !== "" &&
           isSpaceRow(lines[j]) && sameStructure(block[block.length - 1], splitSpaceCells(lines[j]))) {
      block.push(splitSpaceCells(lines[j]));
      j++;
    }
    if (block.length >= 3) {
      /* Нормалізувати кількість комірок до першого рядка. */
      const n = block[0].cells.length;
      const headers = block[0].cells.slice();
      const rows = block.slice(1).map(b => {
        const r = b.cells.slice(0, n);
        while (r.length < n) r.push("");
        return r;
      });
      tables.push({ headers, rows, _from: i, _to: j - 1 });
      for (let k = i; k < j; k++) used.add(k);
      i = j;
    } else {
      i++;
    }
  }
  return tables;
}

/* extractTables(text) → [{headers: string[], rows: string[][]}]
   Знаходить markdown-таблиці та таблиці, вирівняні пробілами.
   headers — перший рядок, rows — решта. Комірки обрізані (trim). */
function extractTables(text) {
  if (text === null || text === undefined) return [];
  const lines = String(text).split(/\r?\n/);
  const md = extractMarkdownTables(lines);
  const space = extractSpaceTables(lines, md.used);
  const all = md.tables.concat(space).sort((a, b) => a._from - b._from);
  return all.map(t => ({ headers: t.headers, rows: t.rows }));
}

module.exports = {
  name: "27-table-extract",
  description: "Витягає таблиці з тексту: markdown (| a | b |) та вирівняні пробілами (2+ пробілів, 3+ рядки однакової структури). Повертає масив {headers, rows} з обрізаними комірками.",
  functions: { extractTables }
};

return module.exports;})();
/* --- #28: generateQuestions --- */
const __imp28=(function(){var module={exports:{}};
/* improvement_28 — генерація питань з тексту (евристика за сутностями).
   Чистий JS, zero dependencies, без мережі. Самодостатній модуль:
   потрібні хелпери (splitSentences, detectLang) скопійовано всередину.
   Експортує generateQuestions(text, n) → string[].
   Логіка: речення з ім'ям → "Хто ...?", з датою → "Коли ...?",
   з місцем → "Де ...?", з числом → "Скільки ...?"
   (en: Who/When/Where/How many; ru: Кто/Когда/Где/Сколько). */
"use strict";

/* --- Хелпери, скопійовані з BridgeCore (самодостатність) --- */

/* Розбити текст на речення. */
function splitSentences(text){
  return String(text||"")
    .replace(/\s+/g," ")
    .split(/(?<=[.!?…])\s+(?=[А-ЯA-ZІЇЄҐЁ])/u)
    .map(s=>s.trim())
    .filter(s=>s.length>1);
}

/* Визначити мову: uk / ru / en. v5.11.94: \b не працює з кирилицею —
   словникові маркери ніколи не спрацьовували. Межі слів через Unicode. */
function detectLang(text){
  const t=String(text||"");
  if(!t.trim())return "en";
  const cyr=(t.match(/[Ѐ-џ]/g)||[]).length;
  const lat=(t.match(/[a-zA-Z]/g)||[]).length;
  if(lat>cyr*3)return "en";
  if(cyr===0)return "en";
  const low=t.toLowerCase();
  const ukScore=((low.match(/[іїєґ]/g)||[]).length)*3+
    ((low.match(/(?<![\p{L}])що(?![\p{L}])|(?<![\p{L}])який(?![\p{L}])|(?<![\p{L}])яка(?![\p{L}])|(?<![\p{L}])які(?![\p{L}])|(?<![\p{L}])це(?![\p{L}])|(?<![\p{L}])цей(?![\p{L}])|(?<![\p{L}])ця(?![\p{L}])|(?<![\p{L}])ці(?![\p{L}])|(?<![\p{L}])але(?![\p{L}])|(?<![\p{L}])вже(?![\p{L}])|(?<![\p{L}])також(?![\p{L}])|(?<![\p{L}])буде(?![\p{L}])|(?<![\p{L}])можна(?![\p{L}])|(?<![\p{L}])треба(?![\p{L}])|(?<![\p{L}])дуже(?![\p{L}])|(?<![\p{L}])тільки(?![\p{L}])/gu)||[]).length);
  const ruScore=((low.match(/[ыъэ]/g)||[]).length)*3+
    ((low.match(/(?<![\p{L}])что(?![\p{L}])|(?<![\p{L}])который(?![\p{L}])|(?<![\p{L}])которая(?![\p{L}])|(?<![\p{L}])которые(?![\p{L}])|(?<![\p{L}])это(?![\p{L}])|(?<![\p{L}])этот(?![\p{L}])|(?<![\p{L}])но(?![\p{L}])|(?<![\p{L}])уже(?![\p{L}])|(?<![\p{L}])также(?![\p{L}])|(?<![\p{L}])будет(?![\p{L}])|(?<![\p{L}])можно(?![\p{L}])|(?<![\p{L}])нужно(?![\p{L}])|(?<![\p{L}])очень(?![\p{L}])|(?<![\p{L}])только(?![\p{L}])/gu)||[]).length);
  if(ukScore===0&&ruScore===0)return lat>cyr?"en":"uk";
  return ukScore>=ruScore?"uk":"ru";
}

/* --- Словники --- */

const UK_MONTHS=["січня","лютого","березня","квітня","травня","червня","липня","серпня","вересня","жовтня","листопада","грудня"];
const RU_MONTHS=["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
const EN_MONTHS=["january","february","march","april","may","june","july","august","september","october","november","december"];
const MONTHS_ALL=new Set([...UK_MONTHS,...RU_MONTHS,...EN_MONTHS]);
const MONTHS_ALT=[...UK_MONTHS,...RU_MONTHS,...EN_MONTHS].join("|");

/* Питальні слова за мовами. */
const QW={
  uk:{who:"Хто",when:"Коли",where:"Де",howmany:"Скільки",whoLow:"хто"},
  ru:{who:"Кто",when:"Когда",where:"Где",howmany:"Сколько",whoLow:"кто"},
  en:{who:"Who",when:"When",where:"Where",howmany:"How many",whoLow:"who"}
};

/* Займенники/вказівні/прийменники, першу літеру яких безпечно робити малою. */
const LOW_FIRST=new Set(("він вона воно вони це цей ця ці той та те я ти ми ви "+
  "за з із в у на до про для під над між через при без від "+
  "he she it they this that these those of in on at to from").split(" "));

/* --- Утиліти --- */

function cleanBody(s){
  let r=String(s).replace(/\s+/g," ").trim();
  r=r.replace(/^[,;:«»“”"'()\-–—\s]+/u,"").trim();
  /* Порожні пари лапок після видалення сутності. */
  r=r.replace(/«\s*»|“\s*”|"\s*"|'\s*'/g,"").replace(/\s+/g," ").trim();
  /* Висячий прийменник перед іншим прийменником/комою («born on in Ulm»). */
  let prev;
  do{
    prev=r;
    r=r.replace(/\s+(on|in|at|to|of|from|near|в|у|на|до|з|із|про|для|під|над|за|між|через|при|без|від|во|из|о|об)\s+(?=(?:in|at|to|of|from|on|near|the|в|у|на|до|з|із|про|для|під|над|за|між|через|при|без|від|во|из|,))/giu," ");
  }while(r!==prev);
  /* Прибрати висячі прийменники/сполучники в кінці. */
  r=r.replace(/\s+(в|у|на|до|з|із|про|для|та|і|й|але|що|во|из|о|об|к|ко|in|at|to|of|from|and|or|the|a|an)\s*$/iu,"").trim();
  /* Кінцева пунктуація — але НЕ лапки, щоб не розпарювати «…». */
  r=r.replace(/[.!?…:;,\-–—\s]+$/u,"").trim();
  return r;
}

function ucfirst(s){return s?s[0].toUpperCase()+s.slice(1):s;}

/* Мала перша літера лише для займенників/вказівних, імена лишаємо як є. */
function smartLcfirst(s){
  if(!s)return s;
  const w=s.split(" ")[0].toLowerCase().replace(/[^\p{L}]/gu,"");
  if(LOW_FIRST.has(w))return s[0].toLowerCase()+s.slice(1);
  return s;
}

function overlaps(a0,a1,spans){
  for(const[b0,b1]of spans)if(a0<b1&&b0<a1)return true;
  return false;
}

/* --- Пошук сутностей у реченні --- */

/* Ім'я: слово з великої (не місяць, не всередині місця).
   На початку речення — лише якщо це ім'я+прізвище (два слова з великої). */
function findName(s,excludeSpans){
  const re=/[А-ЯІЇЄҐЁA-Z][\p{L}']{2,}/gu;
  let m;
  while((m=re.exec(s))){
    if(overlaps(m.index,m.index+m[0].length,excludeSpans))continue;
    if(MONTHS_ALL.has(m[0].toLowerCase()))continue;
    let end=m.index+m[0].length,full=m[0];
    /* Добрати наступне слово з великої (прізвище) або через дефіс (Санкт-Петербурга). */
    const m2=/^(?:\s+|[–—-])([А-ЯІЇЄҐЁA-Z][\p{L}']{2,})/u.exec(s.slice(end));
    if(m2&&!MONTHS_ALL.has(m2[1].toLowerCase())){full+=m2[0][0]===" "? " "+m2[1] : "-"+m2[1];end+=m2[0].length;}
    else if(m.index===0)continue; /* одне слово на початку — звичайне слово речення */
    return{text:full,start:m.index,end};
  }
  return null;
}

/* Дата: "9 березня 1814", "14 March 1879", "10.10.2020", "у 2020 році", рік. */
function findDate(s){
  /* Увага: \b не бачить межі перед/після кирилиці (літери не ASCII),
     тому замість \b біля кириличних слів — явні перевірки. */
  const pats=[
    new RegExp("\\b\\d{1,2}\\s+(?:"+MONTHS_ALT+")(?:\\s+\\d{3,4})?(?:\\s+(?:року|рік|році|р\\.|год[уа]?|years?))?(?![\\p{L}\\p{N}])","iu"),
    /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/,
    /(?:^|[^\p{L}\p{N}])(?:[ву]|in)\s+\d{4}\s*(?:рік|року|році|р\.|год[уа]?|years?|рр\.)(?![\p{L}\p{N}])/iu,
    /\b\d{4}\s*(?:рік|року|році|р\.|год[уа]?|years?|рр\.)(?![\p{L}\p{N}])/iu,
    /\b(1[5-9]\d{2}|20\d{2})\b/
  ];
  for(const p of pats){
    const m=p.exec(s);
    if(m)return{text:m[0],start:m.index,end:m.index+m[0].length};
  }
  return null;
}

/* Місце: власна назва після прийменника місця (в/у/на/до … in/at/from …). */
function findPlace(s,lang){
  const preps=lang==="en"
    ?"city of|town of|in|at|from|to|near|of"
    :"в|у|на|до|з|із|біля|поблизу|від|місто|місті|міста|село|селі|країна|країні|во|из|около|возле|город|городе|селе|страна|стране";
  const nameCls="[А-ЯІЇЄҐЁA-Z][\\p{L}']{2,}";
  /* \b не працює з кириличними прийменниками — межа через lookbehind. */
  const re=new RegExp("(?<=^|[^\\p{L}\\p{N}])(?:"+preps+")\\s+("+nameCls+"(?:[\\s\\-]+(?:"+nameCls+"))?)","giu");
  /* Прапорець i робить [A-Z] нечутливим до регістру — перевіряємо вручну,
     що кожне слово назви справді починається з великої літери. */
  let m;
  while((m=re.exec(s))){
    const words=m[1].split(/[\s\-]+/);
    if(words.every(w=>/^[А-ЯІЇЄҐЁA-Z]/u.test(w)))
      return{full:m[0],place:m[1],start:m.index,end:m.index+m[0].length};
  }
  return null;
}

/* Число (не дата): разом із попереднім квантифікатором (понад/over …). */
function findNumber(s){
  const q="(?:понад|більше|менше|близько|приблизно|майже|over|more than|less than|about|approximately|almost)";
  let m=new RegExp(q+"\\s+\\d(?:[\\d\\s.,]*\\d)?","iu").exec(s);
  if(!m)m=/\d(?:[\d\s.,]*\d)?/.exec(s);
  if(m)return{text:m[0],start:m.index,end:m.index+m[0].length};
  return null;
}

/* --- Головна функція --- */

/* Згенерувати питання з тексту за сутностями речень.
   n — кількість (за замовчуванням 5, максимум 10). */
function generateQuestions(text,n){
  n=(n===undefined||n===null)?5:Math.floor(Number(n));
  if(!Number.isFinite(n))n=5;
  n=Math.max(1,Math.min(10,n));
  const lang=detectLang(text);
  const W=QW[lang]||QW.uk;
  const seen=new Set();
  const out=[];
  const push=q=>{
    q=String(q).trim().replace(/\s+/g," ");
    if(q&&q[q.length-1]!=="?")q+="?";
    if(q.length>3&&!seen.has(q)){seen.add(q);out.push(q);}
  };
  for(const s of splitSentences(text)){
    if(out.length>=n)break;
    const place=findPlace(s,lang);
    const spans=place?[[place.start,place.end]]:[];
    const name=findName(s,spans);
    const date=findDate(s);
    const num=findNumber(s);
    const numIsDate=date&&num&&overlaps(num.start,num.end,[[date.start,date.end]]);
    /* Пріоритет: ім'я → дата → місце → число. */
    if(name){
      const body=cleanBody(s.slice(0,name.start)+W.whoLow+s.slice(name.end));
      if(body)push(ucfirst(body));
    }
    if(date){
      const body=cleanBody(s.slice(0,date.start)+" "+s.slice(date.end));
      if(body)push(W.when+" "+smartLcfirst(body));
    }
    if(place){
      const body=cleanBody(s.slice(0,place.start)+" "+s.slice(place.end));
      if(body)push(W.where+" "+smartLcfirst(body));
    }
    if(num&&!numIsDate){
      const body=cleanBody(s.slice(0,num.start)+" "+s.slice(num.end));
      if(body)push(W.howmany+" "+smartLcfirst(body));
    }
  }
  return out.slice(0,n);
}

module.exports={
  name:"28-question-gen",
  description:"Генерація питань з тексту: знаходить речення з сутностями (імена, дати, місця, числа) і будує питання Хто/Коли/Де/Скільки (en: Who/When/Where/How many).",
  functions:{generateQuestions}
};
return module.exports;})();
/* --- #29: findParaphrases --- */
const __imp29=(function(){var module={exports:{}};
/* improvement_29.js — парафраз-детекція (схожі речення).
   Самодостатній модуль: Жаккар-схожість множин токенів (без стоп-слів)
   для кожної пари речень. Чистий JS, zero dependencies. */
"use strict";

/* Стоп-слова: uk / en / ru (скопійовано з core.js, стисло). */
const STOP=new Set(("а,але,бо,був,була,були,було,буде,будуть,в,вас,весь,від,він,вона,вони,воно,все,всіх,ви,для,до,де,ж,же,з,за,й,його,її,їх,і,із,чи,як,яка,який,які,яку,мене,мені,ми,на,над,нас,не,немає,ні,о,об,ось,під,по,про,с,свій,своя,свої,так,таки,там,те,ти,то,тобто,тоді,тільки,у,це,цей,ця,ці,цю,що,щоб,я,йому,тебе,нього,неї,коли,якщо,або,надто,вже,ще,також,між,через,при,без,кожен,кожна,інший,інша,саме,лише,навіть,дуже,більше,менше,можна,треба,бути,є,нема,от,он"+
",the,a,an,and,or,but,if,then,else,when,at,by,for,with,about,into,through,during,before,after,above,below,to,from,up,down,in,out,on,off,over,under,again,further,once,here,there,all,any,both,each,few,more,most,other,some,such,no,nor,not,only,own,same,so,than,too,very,can,will,just,should,now,is,are,was,were,be,been,being,have,has,had,having,do,does,did,doing,would,could,ought,i,you,he,she,it,we,they,them,their,this,that,these,those,am,as,of,its,my,your,his,her,our"+
",а,но,или,если,то,тогда,так,также,вот,вон,это,эта,эти,этот,к,ко,в,во,на,над,под,о,об,от,до,для,при,без,через,между,из,у,с,со,не,ни,нет,да,же,ж,ли,бы,б,ведь,там,тут,здесь,как,какой,какая,какие,который,которая,которые,что,чтобы,кто,меня,мне,мы,нас,вы,вас,он,она,они,его,ее,их,тебя,себя,мой,моя,мое,мои,твой,твоя,свой,своя,наш,ваш,весь,вся,все,каждый,другой,сам,сама,уже,еще,только,лишь,даже,очень,более,менее,можно,нужно,есть,быть,был,была,были,было,будет,будут,него,нее,когда,или").split(","));

/* Розбити текст на речення. */
function splitSentences(text){
  return String(text||"")
    .replace(/\s+/g," ")
    .split(/(?<=[.!?…])\s+(?=[А-ЯA-ZІЇЄҐЁ])/u)
    .map(s=>s.trim())
    .filter(s=>s.length>1);
}

/* Токенізація: нижній регістр, без стоп-слів, довжина>2, без цифр. */
function tokenize(text){
  return String(text||"").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu," ")
    .split(" ")
    .map(w=>w.trim())
    .filter(w=>w.length>2&&!STOP.has(w)&&!/\d/.test(w));
}

/* Жаккар-схожість двох множин токенів: |A∩B| / |A∪B|. */
function jaccard(a,b){
  const A=new Set(a), B=new Set(b);
  if(A.size===0&&B.size===0)return 1;
  if(A.size===0||B.size===0)return 0;
  let inter=0;
  for(const w of A)if(B.has(w))inter++;
  return inter/(A.size+B.size-inter);
}

/* Знайти парафрази: пари речень зі схожістю [threshold, 1.0).
   Ідентичні (1.0) виключаються. Сортування за similarity спаданням. */
function findParaphrases(text, threshold){
  if(text==null)text="";
  threshold=(typeof threshold==="number"&&isFinite(threshold))?threshold:0.6;
  let sentences=splitSentences(text);
  if(sentences.length<2)return[];
  /* v5.11.93: попарне порівняння квадратичне — обмеження 600 речень (180 тис. пар). */
  if(sentences.length>600)sentences=sentences.slice(0,600);
  const toks=sentences.map(s=>tokenize(s));
  const out=[];
  for(let i=0;i<sentences.length;i++){
    for(let j=i+1;j<sentences.length;j++){
      const sim=jaccard(toks[i],toks[j]);
      const rounded=+sim.toFixed(3);
      if(rounded>=threshold&&rounded<1.0){
        out.push({s1:sentences[i],s2:sentences[j],similarity:rounded});
      }
    }
  }
  out.sort((a,b)=>b.similarity-a.similarity||a.s1.localeCompare(b.s1));
  return out;
}

module.exports={
  name:"29-paraphrase-detection",
  description:"Пошук парафраз: Жаккар-схожість токенів речень без стоп-слів, пари з similarity ≥ threshold і < 1.0, сортування спаданням.",
  functions:{findParaphrases}
};

return module.exports;})();
/* --- #30: tokenizeFast, analyzeLarge --- */
const __imp30=(function(){var module={exports:{}};
/* Покращення #30 — оптимізація для великих текстів (100k+ слів).
   Чистий JS, zero dependencies, жодних мережевих викликів.
   Самодостатній модуль: потрібні хелпери скопійовано з BridgeCore v5.11.70. */
"use strict";

/* Стоп-слова (копія з BridgeCore): uk / en / ru. */
const STOP=new Set(("а,але,бо,був,була,були,було,буде,будуть,в,вас,весь,від,він,вона,вони,воно,все,всіх,ви,для,до,де,ж,же,з,за,й,його,її,їх,і,із,чи,як,яка,який,які,яку,мене,мені,ми,на,над,нас,не,немає,ні,о,об,ось,під,по,про,с,свій,своя,свої,так,таки,там,те,ти,то,тобто,тоді,тільки,у,це,цей,ця,ці,цю,що,щоб,я,йому,тебе,нього,неї,коли,якщо,або,надто,вже,ще,також,між,через,при,без,кожен,кожна,інший,інша,саме,лише,навіть,дуже,більше,менше,можна,треба,будуть,бути,є,нема,от,он,ось"+
",the,a,an,and,or,but,if,then,else,when,at,by,for,with,about,into,through,during,before,after,above,below,to,from,up,down,in,out,on,off,over,under,again,further,once,here,there,all,any,both,each,few,more,most,other,some,such,no,nor,not,only,own,same,so,than,too,very,can,will,just,should,now,is,are,was,were,be,been,being,have,has,had,having,do,does,did,doing,would,could,ought,i,you,he,she,it,we,they,them,their,this,that,these,those,am,as,of,its,my,your,his,her,our"+
",а,но,или,если,то,тогда,так,также,вот,вон,это,эта,эти,этот,к,ко,в,во,на,над,под,о,об,от,до,для,при,без,через,между,из,у,с,со,не,ни,нет,да,же,ж,ли,бы,б,ведь,вон,там,тут,здесь,как,какой,какая,какие,который,которая,которые,что,чтобы,кто,меня,мне,мы,нас,вы,вас,он,она,они,его,ее,их,тебя,себя,мой,моя,мое,мои,твой,твоя,свой,своя,наш,ваш,весь,вся,все,каждый,другой,сам,сама,уже,еще,только,лишь,даже,очень,более,менее,можно,нужно,есть,быть,был,была,были,было,будет,будут,него,нее,когда,или").split(","));

/* Компільовані один раз регулярки: пошук «прогонів» літер/цифр і перевірка цифри. */
const WORD_RUN_RE=/[\p{L}\p{N}]{3,}/gu;
const DIGIT_RE=/\d/;

/* Оптимізована токенізація: один прохід regex по тексту (збір прогонів літер/цифр
   довжиною ≥3) + один цикл фільтрації (стоп-слова, цифри). Без ланцюжків
   .replace().split().map().filter() — мінімум проміжних алокацій.
   Семантика збігається з BridgeCore.tokenize: нижній регістр, токени довжиною >2,
   без стоп-слів, без слів із цифрами. */
function tokenizeFast(text){
  const runs=String(text||"").toLowerCase().match(WORD_RUN_RE);
  if(!runs)return[];
  const out=[];
  for(let i=0;i<runs.length;i++){
    const w=runs[i];
    if(!DIGIT_RE.test(w)&&!STOP.has(w))out.push(w);
  }
  return out;
}

/* Швидкий підрахунок «сирих» слів (за пробільними роздільниками), один прохід. */
function countRawWords(t){
  let n=0,inWord=false;
  for(let i=0;i<t.length;i++){
    const c=t.charCodeAt(i);
    const ws=c===32||c===9||c===10||c===13||c===12||c===11;
    if(ws){inWord=false;}
    else if(!inWord){inWord=true;n++;}
  }
  return n;
}

/* Аналіз великого тексту: токенізація одним проходом, розбиття токенів на чанки
   по chunkWords слів (за замовчуванням 5000) і по-чанкова агрегація частот
   ключових слів у спільну таблицю. Повертає {chunks, keywords, totalWords}. */
function analyzeLarge(text,chunkWords){
  chunkWords=(Number.isFinite(chunkWords)&&chunkWords>0)?Math.floor(chunkWords):5000;
  const t=String(text||"");
  if(!t.trim())return{chunks:0,keywords:[],totalWords:0};
  const tokens=tokenizeFast(t);
  const totalWords=countRawWords(t);
  const chunks=Math.ceil(tokens.length/chunkWords);
  const freq=new Map();
  for(let s=0;s<tokens.length;s+=chunkWords){
    const end=Math.min(s+chunkWords,tokens.length);
    for(let i=s;i<end;i++){
      const w=tokens[i];
      freq.set(w,(freq.get(w)||0)+1);
    }
  }
  const keywords=[...freq.entries()]
    .sort((a,b)=>b[1]-a[1]||(a[0]<b[0]?-1:(a[0]>b[0]?1:0)))
    .slice(0,10)
    .map(([word,count])=>({word,count}));
  return{chunks,keywords,totalWords};
}

module.exports={
  name:"30-large-text-optimization",
  description:"Оптимізація аналізу великих текстів (100k+ слів): одно-прохідна токенізація без ланцюжків проміжних масивів і по-чанкова агрегація частот ключових слів.",
  functions:{tokenizeFast,analyzeLarge}
};

return module.exports;})();
/* --- #31: createCache, memoize --- */
const __imp31=(function(){var module={exports:{}};
/* Agent 31 — кешування результатів аналізу.
   Чистий JS, zero dependencies, без мережевих викликів. */

"use strict";

/* LRU-кеш фіксованого розміру.
   Найдавніше використане = перший елемент у Map (порядок вставки).
   get/has/set оновлюють "свіжість" ключа (переносять у кінець). */
function createCache(maxSize) {
  // Валідація розміру: за замовчуванням 100, мінімум 1.
  if (typeof maxSize !== "number" || !isFinite(maxSize) || Math.floor(maxSize) < 1) {
    maxSize = 100;
  } else {
    maxSize = Math.floor(maxSize);
  }

  var store = new Map();

  // Освіжити ключ: видалити й вставити наново (стає найсвіжішим).
  function touch(key) {
    var v = store.get(key);
    store.delete(key);
    store.set(key, v);
  }

  function get(key) {
    if (!store.has(key)) return undefined;
    touch(key); // читання = використання
    return store.get(key);
  }

  function set(key, value) {
    if (store.has(key)) store.delete(key); // оновлення теж освіжає
    store.set(key, value);
    // Витіснення найдавніше використаного при переповненні.
    while (store.size > maxSize) {
      var oldest = store.keys().next().value;
      store.delete(oldest);
    }
    return value;
  }

  function has(key) {
    return store.has(key);
  }

  function size() {
    return store.size;
  }

  function clear() {
    store.clear();
  }

  return { get: get, set: set, has: has, size: size, clear: clear };
}

/* Мемоізація функції: ключ = JSON.stringify аргументів.
   При повторному виклику з тими ж аргументами повертає кешоване
   значення БЕЗ виклику fn.
   Лічильник реальних викликів fn — у властивості fn.calls (і wrapper.calls). */
function memoize(fn, cache) {
  if (typeof fn !== "function") throw new TypeError("memoize: fn має бути функцією");
  var c = cache || createCache(100);

  fn.calls = 0; // скинути/ініціалізувати лічильник для тестів

  function wrapper() {
    var args = Array.prototype.slice.call(arguments);
    var key;
    try {
      key = JSON.stringify(args);
    } catch (e) {
      // Несеріалізовні аргументи — обходимо кеш, але рахуємо виклик.
      fn.calls++;
      wrapper.calls = fn.calls;
      return fn.apply(this, args);
    }
    if (c.has(key)) {
      return c.get(key);
    }
    fn.calls++;
    wrapper.calls = fn.calls;
    var result = fn.apply(this, args);
    c.set(key, result);
    return result;
  }

  wrapper.calls = 0;
  wrapper.cache = c; // доступ до кеша для тестів/інспекції
  return wrapper;
}

module.exports = {
  name: "31-cache",
  description: "LRU-кеш результатів аналізу та мемоізація функцій: повторні виклики з тими ж аргументами не перераховуються.",
  functions: { createCache: createCache, memoize: memoize }
};

return module.exports;})();
/* --- #32: chunkText, streamProcess, DEFAULT_CHUNK_SIZE --- */
const __imp32=(function(){var module={exports:{}};
/* AI Bridge Core — покращення №32: потокова обробка тексту.
   Розбиття тексту на чанки по chunkSize символів БЕЗ розриву слів
   (різати по останньому пробілу в чанку) і застосування функції
   до кожного чанка. Чистий JS, zero dependencies, без мережі.
   Самодостатній модуль: не залежить від BridgeCore. */
"use strict";

/* Типовий розмір чанка, якщо не задано або задано некоректно. */
const DEFAULT_CHUNK_SIZE = 10000;

/* Нормалізувати розмір чанка: додатне ціле число, інакше типове. */
function normChunkSize(chunkSize) {
  const n = Math.floor(Number(chunkSize));
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CHUNK_SIZE;
}

/* Знайти індекс останнього пробільного символу в рядку (-1, якщо немає). */
function lastSpaceIndex(s) {
  let idx = -1;
  const re = /\s/g;
  let m;
  while ((m = re.exec(s)) !== null) idx = m.index;
  return idx;
}

/* Розбити текст на чанки по chunkSize символів, не розриваючи слова:
   якщо чанк не вміщується — різати по останньому пробілу в чанку.
   Слово довше за chunkSize ріжеться жорстко (інакше не вміститься ніколи).
   Порожній текст / null → []. */
function chunkText(text, chunkSize) {
  const t = String(text || "");
  const size = normChunkSize(chunkSize);
  const chunks = [];
  let rest = t.trim();
  while (rest.length > size) {
    let cut = size;
    /* Не розривати сурогатну пару (емодзі тощо) на межі чанка. */
    const lead = rest.charCodeAt(cut - 1);
    if (lead >= 0xd800 && lead <= 0xdbff) cut--;
    const head = rest.slice(0, cut);
    const spaceIdx = lastSpaceIndex(head);
    let chunk;
    if (spaceIdx > 0) {
      /* Ріжемо по останньому пробілу — слово не розривається. */
      chunk = head.slice(0, spaceIdx);
      rest = rest.slice(spaceIdx).replace(/^\s+/, "");
    } else {
      /* У чанку немає пробілу (одне довге слово) — жорсткий розріз. */
      chunk = head;
      rest = rest.slice(cut).replace(/^\s+/, "");
    }
    chunks.push(chunk.replace(/\s+$/, ""));
  }
  if (rest.length) chunks.push(rest);
  return chunks;
}

/* Застосувати fn(chunk, index) до кожного чанка, зібрати результати в масив.
   Порожній текст → []. Якщо fn не функція — повертаються самі чанки. */
function streamProcess(text, chunkSize, fn) {
  const chunks = chunkText(text, chunkSize);
  const f = typeof fn === "function" ? fn : (c) => c;
  return chunks.map((chunk, index) => f(chunk, index));
}

module.exports = {
  name: "32-stream-processing",
  description:
    "Потокова обробка тексту: розбиття на чанки по N символів без розриву слів (chunkText) і застосування функції до кожного чанка (streamProcess).",
  functions: { chunkText, streamProcess, DEFAULT_CHUNK_SIZE },
};

return module.exports;})();
/* --- #33: exportMarkdown --- */
const __imp33=(function(){var module={exports:{}};
/* improvement_33.js — експорт результатів analyze() у Markdown.
   Самодостатній модуль: не залежить від BridgeCore, нуль залежностей.
   Вхід: analysis = {lang?, stats?, keywords?, summary?, sentiment?}
   Порожні секції пропускаються, null/undefined вхід не кидає виняток. */
"use strict";

/* Екранування спецсимволів Markdown у довільному тексті. */
function escMarkdown(value){
  return String(value==null?"":value)
    .replace(/\\/g,"\\\\")
    .replace(/([`*_{}\[\]()#+!>])/g,"\\$1");
}

/* Приведення числа до читабельного вигляду (без зайвих нулів). */
function fmtNum(v){
  if(typeof v!=="number"||!Number.isFinite(v))return String(v);
  return Number.isInteger(v)?String(v):String(Math.round(v*100)/100);
}

/* Формування текстового опису тональності з різних можливих форматів. */
function sentimentText(s){
  if(typeof s==="string")return s.trim();
  if(Array.isArray(s))return s.map(String).join(", ").trim();
  if(s&&typeof s==="object"){
    const label=s.label!=null?s.label:(s.name!=null?s.name:(s.type!=null?s.type:null));
    const score=s.score!=null?s.score:(s.value!=null?s.value:(s.polarity!=null?s.polarity:null));
    let t=(label!=null?String(label).trim():"")+
          (score!=null?" ("+fmtNum(score)+")":"");
    if(!t.trim()){
      try{t=JSON.stringify(s);}catch(e){t="";}
    }
    return t.trim();
  }
  return "";
}

/* Експорт аналізу в Markdown. Завжди повертає рядок, ніколи не кидає виняток. */
function exportMarkdown(analysis){
  const a=(analysis&&typeof analysis==="object")?analysis:{};
  const out=["# Аналіз тексту"];

  /* Статистика. */
  const st=a.stats;
  if(st&&typeof st==="object"){
    const rows=[];
    if(st.words!=null)rows.push("- слів: "+fmtNum(st.words));
    if(st.sentences!=null)rows.push("- речень: "+fmtNum(st.sentences));
    if(st.chars!=null)rows.push("- символів: "+fmtNum(st.chars));
    if(st.avgSentenceLen!=null)rows.push("- середня довжина речення: "+fmtNum(st.avgSentenceLen));
    if(st.avgWordLen!=null)rows.push("- середня довжина слова: "+fmtNum(st.avgWordLen));
    if(st.uniqueWords!=null)rows.push("- унікальних слів: "+fmtNum(st.uniqueWords));
    if(st.complexity!=null)rows.push("- складність: "+fmtNum(st.complexity));
    if(rows.length){
      out.push("");
      out.push("## Статистика");
      out.push.apply(out,rows);
    }
  }

  /* Ключові слова: маркований список «слово (count)». */
  const kw=a.keywords;
  if(Array.isArray(kw)&&kw.length){
    out.push("");
    out.push("## Ключові слова");
    for(const k of kw){
      if(k==null)continue;
      let word,count;
      if(typeof k==="string"){word=k;count=null;}
      else if(typeof k==="object"){word=k.word!=null?k.word:String(k);count=k.count;}
      else{word=String(k);count=null;}
      word=String(word).trim();
      if(!word)continue;
      out.push("- "+escMarkdown(word)+(count!=null?" ("+fmtNum(count)+")":""));
    }
  }

  /* Резюме: нумерований список речень. */
  const sm=a.summary;
  if(Array.isArray(sm)&&sm.length){
    out.push("");
    out.push("## Резюме");
    let n=0;
    for(const s of sm){
      const t=String(s==null?"":s).trim();
      if(!t)continue;
      n++;
      out.push(n+". "+escMarkdown(t));
    }
    if(n===0){
      /* Речення були порожні — прибрати заголовок секції. */
      out.splice(out.length-2,2);
    }
  }

  /* Тональність — лише якщо є дані. */
  const txt=sentimentText(a.sentiment);
  if(txt){
    out.push("");
    out.push("## Тональність");
    out.push(escMarkdown(txt));
  }

  return out.join("\n");
}

module.exports={
  name:"33-markdown-export",
  description:"Експорт результату analyze() у коректний Markdown-звіт: статистика, ключові слова, резюме, тональність; порожні секції пропускаються.",
  functions:{exportMarkdown:exportMarkdown}
};

return module.exports;})();
/* --- #34: exportJSON, parseAnalysis --- */
const __imp34=(function(){var module={exports:{}};
/* Агент 34 — експорт аналізу в структурований JSON.
   Самодостатній модуль: чистий JS, zero dependencies, жодних мережевих викликів. */
"use strict";

const EXPORT_VERSION = VERSION;

/* Експортувати результат аналізу в структурований JSON-рядок.
   Обгортка: {version, timestamp (ISO), analysis: {...analysis}}.
   Ніколи не кидає винятків: будь-який вхід дає валідний JSON. */
function exportJSON(analysis) {
  // Безпечна копія: якщо вхід не об'єкт — зберігаємо як є (null/примітив).
  const payload = (analysis !== null && typeof analysis === "object")
    ? { ...analysis }
    : analysis;
  return JSON.stringify({
    version: EXPORT_VERSION,
    timestamp: new Date().toISOString(),
    analysis: payload
  }, null, 2);
}

/* Розібрати JSON-рядок, отриманий від exportJSON.
   Повертає об'єкт обгортки або null, якщо JSON невалідний.
   Ніколи не кидає винятків. */
function parseAnalysis(json) {
  try {
    if (typeof json !== "string") return null;
    const parsed = JSON.parse(json);
    return (parsed !== null && typeof parsed === "object") ? parsed : null;
  } catch (e) {
    return null;
  }
}

module.exports = {
  name: "34-json-export",
  description: "Експорт результату аналізу в структурований JSON з версією й міткою часу, та безпечний парсинг назад.",
  functions: { exportJSON, parseAnalysis }
};

return module.exports;})();
/* --- #35: coherence --- */
const __imp35=(function(){var module={exports:{}};
/* Агент 35 — оцінка зв'язності тексту (coherence).
   Чистий JS, zero dependencies, без мережевих викликів.
   Логіка: для кожної пари сусідніх речень рахуємо Жаккар-схожість
   множин токенів (без стоп-слів) + бонус за сполучники-зв'язки.
   Підсумковий score — середнє арифметичне по всіх парах. */
"use strict";

/* Стоп-слова uk/en/ru — копія з core.js v5.11.70 (потрібні для tokenize). */
const STOP=new Set(("а,але,бо,був,була,були,було,буде,будуть,в,вас,весь,від,він,вона,вони,воно,все,всіх,ви,для,до,де,ж,же,з,за,й,його,її,їх,і,із,чи,як,яка,який,які,яку,мене,мені,ми,на,над,нас,не,немає,ні,о,об,ось,під,по,про,с,свій,своя,свої,так,таки,там,те,ти,то,тобто,тоді,тільки,у,це,цей,ця,ці,цю,що,щоб,я,йому,тебе,нього,неї,коли,якщо,або,надто,вже,ще,також,між,через,при,без,кожен,кожна,інший,інша,саме,лише,навіть,дуже,більше,менше,можна,треба,будуть,бути,є,нема,от,он,ось"+
",the,a,an,and,or,but,if,then,else,when,at,by,for,with,about,into,through,during,before,after,above,below,to,from,up,down,in,out,on,off,over,under,again,further,once,here,there,all,any,both,each,few,more,most,other,some,such,no,nor,not,only,own,same,so,than,too,very,can,will,just,should,now,is,are,was,were,be,been,being,have,has,had,having,do,does,did,doing,would,could,ought,i,you,he,she,it,we,they,them,their,this,that,these,those,am,as,of,its,my,your,his,her,our"+
",а,но,или,если,то,тогда,так,также,вот,вон,это,эта,эти,этот,к,ко,в,во,на,над,под,о,об,от,до,для,при,без,через,между,из,у,с,со,не,ни,нет,да,же,ж,ли,бы,б,ведь,вон,там,тут,здесь,как,какой,какая,какие,который,которая,которые,что,чтобы,кто,меня,мне,мы,нас,вы,вас,он,она,они,его,ее,их,тебя,себя,мой,моя,мое,мои,твой,твоя,свой,своя,наш,ваш,весь,вся,все,каждый,другой,сам,сама,уже,еще,только,лишь,даже,очень,более,менее,можно,нужно,есть,быть,был,была,были,было,будет,будут,него,нее,когда,или").split(","));

/* Сполучники-зв'язки (дискурсивні маркери): uk / en / ru.
   Шукаємо їх у «сирих» словах речення, бо частина з них — стоп-слова
   (але, however, therefore) і tokenize їх відкидає. */
const CONNECTORS=new Set([
  "але","проте","однак","втім","тому","отже","тож","тобто","адже",
  "водночас","натомість","оскільки","притому","зате","наприклад",
  "however","therefore","thus","hence","although","though","meanwhile",
  "whereas","because","moreover","furthermore","instead","otherwise",
  "consequently","accordingly","nevertheless","nonetheless",
  "но","однако","поэтому","потому","итак","поскольку","зато","вместе","например"
]);

/* Розбити текст на речення — копія логіки core.js. */
function splitSentences(text){
  return String(text||"")
    .replace(/\s+/g," ")
    .split(/(?<=[.!?…])\s+(?=[А-ЯA-ZІЇЄҐЁ])/u)
    .map(s=>s.trim())
    .filter(s=>s.length>1);
}

/* Токенізація без стоп-слів — копія логіки core.js. */
function tokenize(text){
  return String(text||"").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu," ")
    .split(" ")
    .map(w=>w.trim())
    .filter(w=>w.length>2&&!STOP.has(w)&&!/\d/.test(w));
}

/* «Сирі» слова речення (нижній регістр, без фільтра стоп-слів) —
   потрібні, щоб знайти сполучники-зв'язки. */
function rawWords(text){
  return String(text||"").toLowerCase()
    .replace(/[^\p{L}]+/gu," ")
    .split(" ")
    .map(w=>w.trim())
    .filter(w=>w.length>1);
}

/* Множина сполучників-зв'язків у реченні. */
function connectorsOf(sentence){
  const out=new Set();
  for(const w of rawWords(sentence)){
    if(CONNECTORS.has(w))out.add(w);
  }
  return out;
}

/* Оцінка однієї пари сусідніх речень:
   Жаккар токенів + бонус за сполучники-зв'язки. */
function pairScore(sa,sb){
  const ta=new Set(tokenize(sa));
  const tb=new Set(tokenize(sb));
  let inter=0;
  for(const w of ta)if(tb.has(w))inter++;
  const union=ta.size+tb.size-inter;
  /* Обидві множини порожні (речення лише зі стоп-слів) — збігу немає. */
  const jac=union===0?0:inter/union;

  const ca=connectorsOf(sa);
  const cb=connectorsOf(sb);
  let shared=0;
  for(const c of ca)if(cb.has(c))shared++;
  /* Бонус: +0.15 за спільний сполучник у парі,
     +0.05 якщо зв'язки є в обох реченнях, але різні. */
  const bonus=shared>0?0.15:(ca.size>0&&cb.size>0?0.05:0);

  return Math.min(1,jac+bonus);
}

/* Оцінка зв'язності тексту.
   text: рядок. Повертає {score: 0..1, level: "висока"|"середня"|"низька"|"недостатньо даних"}.
   Менше 2 речень → {score: 1, level: "недостатньо даних"}.
   Безпечна для порожнього рядка / null — винятків не кидає. */
function coherence(text){
  const sentences=splitSentences(text);
  if(sentences.length<2)return{score:1,level:"недостатньо даних"};
  let sum=0;
  for(let i=0;i<sentences.length-1;i++){
    sum+=pairScore(sentences[i],sentences[i+1]);
  }
  const score=sum/(sentences.length-1);
  const level=score>=0.3?"висока":score>=0.15?"середня":"низька";
  return{score:+score.toFixed(4),level};
}

module.exports={
  name:"35-coherence",
  description:"Оцінка зв'язності тексту: Жаккар-схожість токенів сусідніх речень (без стоп-слів) плюс бонус за спільні сполучники-зв'язки (але, тому, отже, however, therefore).",
  functions:{coherence}
};

return module.exports;})();
/* --- #36: detectLangMixed, detectLangSeg, splitSeg --- */
const __imp36=(function(){var module={exports:{}};
/* Agent 36 — покращена детекція мови для змішаних текстів.
   Чистий JavaScript, zero dependencies. Працює офлайн.
   Самодостатній модуль: хелпери скопійовано всередину, BridgeCore не потрібен. */
"use strict";

/* Стоп-слова за мовами (міні-набори, українською пріоритет). */
const STOP_UK=new Set("і,в,на,з,що,це,як,та,не,але,до,для,від,про,у,й,то,так,вже,ще,також,лише,навіть,дуже,більше,менше,можна,треба,є,немає,нема,було,буде,була,були,він,вона,вони,мене,мені,ми,нас,ти,тоді,тільки,між,через,при,без,кожен,інший,саме,коли,якщо,або,надто,сьогодні,зараз".split(","));
const STOP_RU=new Set("и,в,на,с,что,это,как,а,но,не,для,при,без,через,между,из,со,да,нет,же,ли,уже,еще,также,только,лишь,даже,очень,более,менее,можно,нужно,есть,было,будет,был,была,были,он,она,они,меня,мне,мы,нас,вы,вас,тогда,когда,если,сегодня,сейчас,который,которая,которые".split(","));
const STOP_EN=new Set("the,a,an,and,or,but,if,then,when,for,with,about,into,through,during,before,after,to,from,in,out,on,off,over,under,here,there,all,each,few,more,most,other,some,such,nor,not,only,same,than,too,very,can,will,just,should,now,is,are,was,were,be,been,have,has,had,do,does,did,would,could,i,you,he,she,it,we,they,this,that,these,those,am,as,of,its,my,your,his,her,our,today".split(","));

/* Типові слова-індикатори для розрізнення uk/ru у сегментах без маркерів іїєґ/ыъэ. */
const UK_DICT=new Set("ранок,ранку,сьогодні,погода,погоди,сонце,світить,світити,гуляти,парк,разом,підемо,піти,гарний,добре,теж,зараз,тут,тому,щоб,який,яка,які,цей,ця,ці,справа,справи,життя,час,день,дні,людина,люди,робота,дім,місто,країна,новий,стара,великий,робити,каже,сказав,може,повинен,потрібна,дякую,привіт,доброго,вечір,ніч,хочу,люблю,знаю,думаю,бачу,чудова,чудовий,гарна,свіже".split(","));
const RU_DICT=new Set("утро,утра,сегодня,погода,погоды,солнце,светит,светить,гулять,парк,вместе,пойдем,пойти,хороший,хорошо,тоже,сейчас,здесь,потому,чтобы,который,какая,какие,этот,эта,эти,дело,дела,жизнь,время,день,дни,человек,люди,работа,дом,город,страна,новый,старая,большой,делать,говорит,сказал,может,должен,нужна,спасибо,пожалуйста,привет,доброе,вечер,ночь,хочу,люблю,знаю,думаю,вижу,отличная,отличный,хорошая,свежее".split(","));

/* Розбити текст на речення (самодостатня копія логіки core.js). */
function splitSeg(text){
  return String(text||"")
    .replace(/\s+/g," ")
    .split(/(?<=[.!?…])\s+(?=[А-ЯA-ZІЇЄҐЁ])/u)
    .map(s=>s.trim())
    .filter(s=>s.length>1);
}

/* Підрахувати входження стоп-слів мови в текст (цілі слова, unicode).
   v5.11.94: було ~300 regex-проходів на сегмент (2 с на 160k символів) —
   тепер одна токенізація + Set-lookup. */
function countStops(low,set){
  const words=low.match(/[\p{L}]+/gu)||[];
  let n=0;
  for(const w of words)if(set.has(w))n++;
  return n;
}

/* Визначити мову ОДНОГО сегмента: "uk" | "ru" | "en" | null (немає літер). */
function detectLangSeg(seg){
  const t=String(seg||"");
  const cyr=(t.match(/[Ѐ-џ]/g)||[]).length; /* \u0400-\u04FF */
  const lat=(t.match(/[a-zA-Z]/g)||[]).length;
  if(cyr+lat===0)return null;
  const low=t.toLowerCase();
  /* Маркери: іїєґ — українська, ыъэ — російська. */
  const ukMark=(low.match(/[іїєґ]/g)||[]).length;
  const ruMark=(low.match(/[ыъэ]/g)||[]).length;
  let uk=ukMark*3+countStops(low,STOP_UK)*2+countStops(low,UK_DICT)*2+cyr;
  let ru=ruMark*3+countStops(low,STOP_RU)*2+countStops(low,RU_DICT)*2+cyr;
  let en=countStops(low,STOP_EN)*2+lat;
  /* Нічия: пріоритет uk > en > ru. */
  if(uk>=en&&uk>=ru)return"uk";
  if(en>=ru)return"en";
  return"ru";
}

/* Вага сегмента: кількість слів (букви/цифри). */
function segWeight(seg){
  const w=String(seg||"").toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim().split(/\s+/).filter(Boolean).length;
  return w;
}

/* Детекція мови для змішаних текстів.
   Повертає {primary, langs:{uk,ru,en}}, частки 0..1, сума 1. */
function detectLangMixed(text){
  const t=String(text||"");
  const empty={primary:"uk",langs:{uk:1,ru:0,en:0}};
  if(!t.trim())return empty;
  const segs=splitSeg(t);
  if(!segs.length)return empty;
  const acc={uk:0,ru:0,en:0};
  let total=0;
  /* v5.11.94: бюджет часу 1500 мс — було 2 с на 160k символів. */
  const deadline=Date.now()+1500;
  let truncated=false;
  for(const s of segs){
    if(Date.now()>deadline){truncated=true;break;}
    const lang=detectLangSeg(s);
    if(!lang)continue;
    const w=Math.max(1,segWeight(s));
    acc[lang]+=w;total+=w;
  }
  if(total===0)return empty;
  const langs={uk:+(acc.uk/total).toFixed(4),ru:+(acc.ru/total).toFixed(4),en:+(acc.en/total).toFixed(4)};
  /* Нормалізація щоб сума була рівно 1 (після округлення). */
  const sum=langs.uk+langs.ru+langs.en;
  langs.uk=+(langs.uk/sum).toFixed(4);
  langs.ru=+(langs.ru/sum).toFixed(4);
  langs.en=+(langs.en/sum).toFixed(4);
  let primary="uk";
  if(langs.en>langs.uk&&langs.en>=langs.ru)primary="en";
  else if(langs.ru>langs.uk&&langs.ru>langs.en)primary="ru";
  return{primary,langs,truncated};
}

module.exports={
  name:"36-mixed-lang-detect",
  description:"Детекція мови для змішаних текстів: розбиває текст на речення, визначає мову кожного (кирилиця/латиниця + маркери іїєґ/ыъэ + стоп-слова) і повертає частки мов та первинну мову.",
  functions:{detectLangMixed,detectLangSeg,splitSeg}
};

return module.exports;})();
/* --- #37: statsExtended --- */
const __imp37=(function(){var module={exports:{}};
/* BridgeCore improvement #37 — розширена статистика тексту.
   Самодостатній CommonJS модуль: не залежить від BridgeCore,
   логіка stats() і хелпери скопійовані точно з core.js v5.11.70.
   Чистий JS, zero dependencies, без мережевих викликів. */

/* Стоп-слова: uk / en / ru. Копія з core.js. */
const STOP=new Set(("а,але,бо,був,була,були,було,буде,будуть,в,вас,весь,від,він,вона,вони,воно,все,всіх,ви,для,до,де,ж,же,з,за,й,його,її,їх,і,із,чи,як,яка,який,які,яку,мене,мені,ми,на,над,нас,не,немає,ні,о,об,ось,під,по,про,с,свій,своя,свої,так,таки,там,те,ти,то,тобто,тоді,тільки,у,це,цей,ця,ці,цю,що,щоб,я,йому,тебе,нього,неї,коли,якщо,або,надто,вже,ще,також,між,через,при,без,кожен,кожна,інший,інша,саме,лише,навіть,дуже,більше,менше,можна,треба,будуть,бути,є,нема,от,он,ось"+
",the,a,an,and,or,but,if,then,else,when,at,by,for,with,about,into,through,during,before,after,above,below,to,from,up,down,in,out,on,off,over,under,again,further,once,here,there,all,any,both,each,few,more,most,other,some,such,no,nor,not,only,own,same,so,than,too,very,can,will,just,should,now,is,are,was,were,be,been,being,have,has,had,having,do,does,did,doing,would,could,ought,i,you,he,she,it,we,they,them,their,this,that,these,those,am,as,of,its,my,your,his,her,our"+
",а,но,или,если,то,тогда,так,также,вот,вон,это,эта,эти,этот,к,ко,в,во,на,над,под,о,об,от,до,для,при,без,через,между,из,у,с,со,не,ни,нет,да,же,ж,ли,бы,б,ведь,вон,там,тут,здесь,как,какой,какая,какие,который,которая,которые,что,чтобы,кто,меня,мне,мы,нас,вы,вас,он,она,они,его,ее,их,тебя,себя,мой,моя,мое,мои,твой,твоя,свой,своя,наш,ваш,весь,вся,все,каждый,другой,сам,сама,уже,еще,только,лишь,даже,очень,более,менее,можно,нужно,есть,быть,был,была,были,было,будет,будут,него,нее,когда,или").split(","));

/* Розбити текст на речення. Копія з core.js. */
function splitSentences(text){
  return String(text||"")
    .replace(/\s+/g," ")
    .split(/(?<=[.!?…])\s+(?=[А-ЯA-ZІЇЄҐЁ])/u)
    .map(s=>s.trim())
    .filter(s=>s.length>1);
}

/* Токенізація. Копія з core.js. */
function tokenize(text){
  return String(text||"").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu," ")
    .split(" ")
    .map(w=>w.trim())
    .filter(w=>w.length>2&&!STOP.has(w)&&!/\d/.test(w));
}

/* Кількість слів у рядку (сирі слова через пробіли). */
function rawWordCount(s){
  return s.trim()?s.trim().split(/\s+/).length:0;
}

/* Розбити текст на абзаци за порожніми рядками. */
function splitParagraphs(text){
  return String(text||"")
    .split(/\n\s*\n/)
    .map(p=>p.replace(/\s+/g," ").trim())
    .filter(p=>p.length>0);
}

/* Медіана числового масиву (копія не сортується). */
function median(nums){
  if(!nums.length)return 0;
  const sorted=nums.slice().sort((a,b)=>a-b);
  const mid=Math.floor(sorted.length/2);
  const m=sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;
  return +m.toFixed(1);
}

/* Розширена статистика: всі поля базового stats() + додаткові.
   longest/shortest — найдовше/найкоротше речення за кількістю слів
   (нічия вирішується на користь першого речення). */
function statsExtended(text){
  const t=String(text||"");
  const sentences=splitSentences(t);
  const tokens=tokenize(t);
  const rawWords=t.trim()?t.trim().split(/\s+/).length:0;
  const avgSent=sentences.length?(tokens.length/sentences.length):0;
  const avgWord=tokens.length?(tokens.reduce((a,w)=>a+w.length,0)/tokens.length):0;
  const unique=new Set(tokens).size;
  const complexity=Math.min(100,Math.round(avgSent*2.2+avgWord*4+(tokens.length?Math.max(0,(1-unique/tokens.length))*30:0)));

  /* Довжини речень у словах (порядок збережено). */
  const sentLens=sentences.map(rawWordCount);
  let longestSentence="",shortestSentence="";
  if(sentences.length){
    let maxI=0,minI=0;
    for(let i=1;i<sentences.length;i++){
      if(sentLens[i]>sentLens[maxI])maxI=i;
      if(sentLens[i]<sentLens[minI])minI=i;
    }
    longestSentence=sentences[maxI];
    shortestSentence=sentences[minI];
  }

  /* Абзаци. */
  const paragraphs=splitParagraphs(t);
  const paraWordCounts=paragraphs.map(rawWordCount);
  const avgParagraphLen=paragraphs.length
    ? +(paraWordCounts.reduce((a,n)=>a+n,0)/paragraphs.length).toFixed(1)
    : 0;

  return{
    chars:t.length,
    words:rawWords,
    sentences:sentences.length,
    avgSentenceLen:+avgSent.toFixed(1),
    avgWordLen:+avgWord.toFixed(1),
    uniqueWords:unique,
    complexity,
    longestSentence,
    shortestSentence,
    medianSentenceLen:median(sentLens),
    paragraphs:paragraphs.length,
    avgParagraphLen
  };
}

module.exports={
  name:"37-extended-stats",
  description:"Розширена статистика тексту: базові поля stats() плюс найдовше/найкоротше речення, медіанна довжина речення, кількість абзаців і середня довжина абзацу.",
  functions:{statsExtended}
};

return module.exports;})();
/* --- #38: textSimilarity --- */
const __imp38=(function(){var module={exports:{}};
/* improvement_38 — порівняння двох текстів (схожість).
   Чистий JS, zero dependencies. Самодостатній модуль: хелпери скопійовано з core.js v5.11.70. */
"use strict";

/* Скорочений практичний набір стоп-слів (uk/en/ru) — з core.js. */
const STOP = new Set(("а,але,бо,був,була,були,було,буде,будуть,в,вас,весь,від,він,вона,вони,воно,все,всіх,ви,для,до,де,ж,же,з,за,й,його,її,їх,і,із,чи,як,яка,який,які,яку,мене,мені,ми,на,над,нас,не,немає,ні,о,об,ось,під,по,про,с,свій,своя,свої,так,таки,там,те,ти,то,тобто,тоді,тільки,у,це,цей,ця,ці,цю,що,щоб,я,йому,тебе,нього,неї,коли,якщо,або,надто,вже,ще,також,між,через,при,без,кожен,кожна,інший,інша,саме,лише,навіть,дуже,більше,менше,можна,треба,бути,є,нема,от,он" +
",the,a,an,and,or,but,if,then,else,when,at,by,for,with,about,into,through,during,before,after,above,below,to,from,up,down,in,out,on,off,over,under,again,further,once,here,there,all,any,both,each,few,more,most,other,some,such,no,nor,not,only,own,same,so,than,too,very,can,will,just,should,now,is,are,was,were,be,been,being,have,has,had,having,do,does,did,doing,would,could,ought,i,you,he,she,it,we,they,them,their,this,that,these,those,am,as,of,its,my,your,his,her,our" +
",а,но,или,если,то,тогда,так,также,вот,вон,это,эта,эти,этот,к,ко,в,во,на,над,под,о,об,от,до,для,при,без,через,между,из,у,с,со,не,ни,нет,да,же,ж,ли,бы,б,ведь,вон,там,тут,здесь,как,какой,какая,какие,который,которая,которые,что,чтобы,кто,меня,мне,мы,нас,вы,вас,он,она,они,его,ее,их,тебя,себя,мой,моя,мое,мои,твой,твоя,свой,своя,наш,ваш,весь,вся,все,каждый,другой,сам,сама,уже,еще,только,лишь,даже,очень,более,менее,можно,нужно,есть,быть,был,была,были,было,будет,будут,него,нее,когда,или").split(","));

/* Токенізація: як у core.js — нижній регістр, літери/цифри unicode, довжина>2, без стоп-слів і цифр. */
function tokenize(text) {
  return String(text || "").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .map(w => w.trim())
    .filter(w => w.length > 2 && !STOP.has(w) && !/\d/.test(w));
}

/* Частоти токенів → Map. */
function wordFreq(tokens) {
  const m = new Map();
  for (const w of tokens) m.set(w, (m.get(w) || 0) + 1);
  return m;
}

/* Jaccard: |A∩B| / |A∪B| множин токенів. */
function jaccardSets(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 0;
  let inter = 0;
  for (const w of setA) if (setB.has(w)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

/* Косинусна схожість TF-векторів. */
function cosineTf(freqA, freqB) {
  let dot = 0, normA = 0, normB = 0;
  for (const [, c] of freqA) normA += c * c;
  for (const [, c] of freqB) normB += c * c;
  if (normA === 0 || normB === 0) return 0;
  for (const [w, c] of freqA) {
    const cb = freqB.get(w);
    if (cb !== undefined) dot += c * cb;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/* Порівняння двох текстів: {score, jaccard, cosine}.
   score = (jaccard + cosine) / 2. Ідентичні → 1, порожні → 0. Ніколи не кидає винятки. */
function textSimilarity(a, b) {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (!ta.length && !tb.length) return { score: 0, jaccard: 0, cosine: 0 };
  const setA = new Set(ta), setB = new Set(tb);
  const jaccard = jaccardSets(setA, setB);
  const cosine = cosineTf(wordFreq(ta), wordFreq(tb));
  return { score: (jaccard + cosine) / 2, jaccard, cosine };
}

module.exports = {
  name: "38-text-similarity",
  description: "Порівняння двох текстів: Jaccard множин токенів і косинусна схожість TF-векторів, зведена оцінка score 0..1.",
  functions: { textSimilarity }
};

return module.exports;})();
/* --- #39: fingerprint --- */
const __imp39=(function(){var module={exports:{}};
/* improvement_39.js — відбиток тексту (fingerprint) для дедуплікації.
   Самодостатній CommonJS модуль: чистий JS, zero dependencies, без мережі.
   Нормалізація: нижній регістр → видалення пунктуації → токенізація →
   прибирання стоп-слів → сортування токенів → з'єднання → FNV-1a 32-біт. */
"use strict";

/* Власний базовий набір стоп-слів (uk / en / ru). */
const STOP = new Set((
  "а,але,бо,був,була,були,було,буде,будуть,в,вас,весь,від,він,вона,вони,воно," +
  "все,всіх,ви,для,до,де,ж,же,з,за,й,його,її,їх,і,із,чи,як,яка,який,які,яку," +
  "мене,мені,ми,на,над,нас,не,немає,ні,о,об,ось,під,по,про,с,свій,своя,свої," +
  "так,та,таки,там,те,ти,то,тобто,тоді,тільки,у,це,цей,ця,ці,цю,що,щоб,я,йому," +
  "тебе,нього,неї,коли,якщо,або,надто,вже,ще,також,між,через,при,без,кожен," +
  "кожна,інший,інша,саме,лише,навіть,дуже,більше,менше,можна,треба,є,нема,от,он" +
  ",the,a,an,and,or,but,if,then,else,when,at,by,for,with,about,into,through," +
  "during,before,after,above,below,to,from,up,down,in,out,on,off,over,under," +
  "again,further,once,here,there,all,any,both,each,few,more,most,other,some," +
  "such,no,nor,not,only,own,same,so,than,too,very,can,will,just,should,now," +
  "is,are,was,were,be,been,being,have,has,had,having,do,does,did,doing,would," +
  "could,ought,i,you,he,she,it,we,they,them,their,this,that,these,those,am,as," +
  "of,its,my,your,his,her,our" +
  ",а,но,или,если,то,тогда,так,также,вот,вон,это,эта,эти,этот,к,ко,во,над,под," +
  "об,от,для,при,без,через,между,из,у,со,ни,нет,да,ли,бы,б,ведь,тут,здесь," +
  "как,какой,какая,какие,который,которая,которые,что,чтобы,кто,меня,мне,мы," +
  "нас,вы,вас,он,она,они,его,ее,их,тебя,себя,мой,моя,мое,мои,твой,твоя," +
  "свой,своя,наш,ваш,весь,вся,все,каждый,другой,сам,сама,уже,еще,только," +
  "лишь,даже,очень,более,менее,можно,нужно,есть,быть,был,была,были,было," +
  "будет,будут,него,нее,когда").split(","));

/* Хеш FNV-1a 32-біт: offset basis 2166136261, prime 16777619.
   Повертає непідписане 32-бітне число. */
function fnv1a32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/* Відбиток тексту для дедуплікації.
   text: string | null | undefined → 8 hex-символів (FNV-1a 32-біт).
   Однаковий текст (різний регістр/пробіли) → однаковий відбиток. */
function fingerprint(text) {
  const tokens = String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ") // пунктуація → пробіли
    .split(" ")
    .map(w => w.trim())
    .filter(w => w.length > 0 && !STOP.has(w) && !/^\d+$/.test(w)); // прибрати стоп-слова і чисті числа
  tokens.sort(); // детермінований порядок незалежно від порядку слів у тексті
  const normalized = tokens.join("|");
  const hash = fnv1a32(normalized);
  return hash.toString(16).padStart(8, "0"); // завжди 8 hex-символів
}

module.exports = {
  name: "39-fingerprint",
  description: "Відбиток тексту (fingerprint) для дедуплікації: нормалізація (регістр, пунктуація, стоп-слова, сортування токенів) + хеш FNV-1a 32-біт.",
  functions: { fingerprint }
};

return module.exports;})();
/* === v5.11.75 «Захист Ядра»: цілісність + безпечні обгортки === */

/* FNV-1a 32-біт для хешу цілісності. */
function __fnv1a(str){
  let h=0x811c9dc5;
  for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,0x01000193);}
  return(h>>>0).toString(16).padStart(8,"0");
}

/* Ключові функції, що входять у хеш цілісності. */
const __INTEGRITY_FNS=["detectLang","stats","keywords","summarize","answer","analyze","splitSentences","tokenize","escapeHtml","guardInput"];
function __integrityHash(scope){
  return __fnv1a(__INTEGRITY_FNS.map(n=>{
    try{const f=scope[n];return typeof f==="function"?f.toString():"?";}
    catch(e){return"!";}
  }).join("\n"));
}

/* Базова лінія — хеш функцій ТАК, ЯК ВОНИ ЕКСПОНОВАНІ (після safe-обгорток).
   Обчислюється після збірки __safeExports, нижче. */
let __integrityBaseline="pending";
let __publicRef=null; /* заповнюється нижче — живий публічний об'єкт */

/* Самоперевірка цілісності: порівнює поточні публічні функції з базовою лінією.
   Повертає {ok, expected, actual}. При розбіжності — console.warn. */
function verifyIntegrity(){
  try{
    const scope=__publicRef||{};
    const actual=__integrityHash(scope);
    const ok=actual===__integrityBaseline;
    if(!ok&&typeof console!=="undefined"&&console.warn)
      console.warn("[BridgeCore] Цілісність порушено: хеш "+actual+" ≠ базовий "+__integrityBaseline);
    return{ok,expected:__integrityBaseline,actual};
  }catch(e){
    return{ok:false,expected:__integrityBaseline,actual:"error"};
  }
}

/* Безпечні обгортки: жодна помилка ядра не роняє застосунок.
   Чесні CoreError (tooLarge/timeout) прокидаються — їх показує UI. */
const __SAFE_FALLBACKS={
  detectLang:()=>"en",
  splitSentences:()=>[],
  tokenize:()=>[],
  stats:()=>({chars:0,words:0,sentences:0,avgSentenceLen:0,avgWordLen:0,uniqueWords:0,complexity:0}),
  keywords:()=>[],
  summarize:()=>[],
  answer:()=>[],
  analyze:()=>({lang:"en",stats:{chars:0,words:0,sentences:0,avgSentenceLen:0,avgWordLen:0,uniqueWords:0,complexity:0},keywords:[],summary:[],partial:false,error:true}),
  escapeHtml:()=>""
};
function __safeWrap(name,fn){
  const fb=__SAFE_FALLBACKS[name];
  return function(){
    try{return fn.apply(this,arguments);}
    catch(e){
      if(e&&e.isCoreError)throw e; /* чесна помилка — нагору */
      try{if(typeof console!=="undefined"&&console.error)console.error("[BridgeCore] "+name+" failed:",e&&e.message||e);}catch(_){}
      return typeof fb==="function"?fb():(fb!==undefined?fb:null);
    }
  };
}

/* ======================================================================================
   v5.11.95 — АСИСТЕНТ ЯДРА: самостійний локальний помічник (без мережі, без LLM).
   createAssistant(opts) → { respond, learn, remember, forget, exportMemory, importMemory, memoryInfo }

   Що він робить САМ:
   • розуміє намір (привітання, рахунок, одиниці, дати, робота з текстом, пам'ять, питання);
   • веде розмову: пам'ятає останній текст і відповідь («коротше», «докладніше», «а які дати?»);
   • має пам'ять: факти («запам'ятай, що…»), вивчені документи, нотатки — і шукає в них відповідь;
   • знає довідку про сам AI Bridge;
   • оцінює власну впевненість і чесно каже, коли питання треба передати хмарному AI
     (escalate:true) — застосунок може зробити це автоматично.
   Це НЕ нейромережа: він не вигадує і не міркує про довільні теми. Усе, що він каже,
   або обчислено, або дослівно взято з тексту/пам'яті з позначкою джерела.
   ====================================================================================== */
const __A_LIM={facts:300,factChars:500,docs:40,docChars:120000,totalDocChars:600000,notes:300};
const __A_MONTHS={
  uk:["січня","лютого","березня","квітня","травня","червня","липня","серпня","вересня","жовтня","листопада","грудня"],
  ru:["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"],
  en:["January","February","March","April","May","June","July","August","September","October","November","December"]
};
const __A_DAYS={
  uk:["неділя","понеділок","вівторок","середа","четвер","п'ятниця","субота"],
  ru:["воскресенье","понедельник","вторник","среда","четверг","пятница","суббота"],
  en:["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"]
};
/* Основи назв місяців для розбору дат (перші літери, усі три мови). */
const __A_MONTH_STEMS=[["січ","янв","jan"],["лют","фев","feb"],["берез","март","mar"],["квіт","апр","apr"],["трав","мая","май","may"],["черв","июн","jun"],["лип","июл","jul"],["серп","авг","aug"],["верес","сент","sep"],["жовт","окт","oct"],["листоп","нояб","nov"],["груд","дек","dec"]];
const __A_T={
uk:{
  hello:["Привіт! Чим допомогти?","Вітаю! Що зробити?","Привіт! Я на місці — питай."],
  helloName:"Привіт, {name}! Чим допомогти?",
  how:"Працюю справно, дякую. Усе рахую на цьому пристрої, без інтернету. Що зробити?",
  thanks:["Будь ласка!","Радий допомогти.","Звертайся."],
  bye:"До зустрічі!",
  who:"Я — Ядро AI Bridge: локальний помічник, який працює прямо на цьому пристрої, без сервера й інтернету. Я не нейромережа: рахую, шукаю в текстах і в пам'яті, підсумовую — і чесно кажу, коли питання треба передати хмарному AI.",
  help:"Ось що я вмію сам, без інтернету:\n\n- **Рахувати:** «скільки буде 15% від 240», «(12+8)*3», «корінь з 144»\n- **Переводити одиниці:** «5 миль у км», «70 кг у фунти», «20 C у F»\n- **Дати й час:** «яке сьогодні число», «скільки днів до 25 грудня», «який день тижня 1 січня»\n- **Працювати з текстом:** встав текст або додай файл і скажи «підсумуй», «ключові слова», «які дати», «що треба зробити», «статистика»\n- **Відповідати на питання за текстом** — з файлу, з останнього тексту в розмові або з пам'яті\n- **Пам'ятати:** «запам'ятай, що пароль від Wi-Fi у шухляді», «запам'ятай цей документ», «що ти пам'ятаєш», «забудь про Wi-Fi»\n- **Довідка про AI Bridge:** «як додати ключ», «що таке KV», «чим відрізняються режими»\n\nЯкщо питання мені не під силу — скажу про це прямо і запропоную хмарний AI.",
  remembered:"Запам'ятав: «{x}».",
  rememberedName:"Приємно познайомитись, {name}! Запам'ятав.",
  learnedDoc:"Вивчив документ «{title}» ({n} речень). Тепер можеш ставити питання за ним — навіть у новій розмові.",
  docTooBig:"Документ завеликий для пам'яті — зберіг перші {n} символів.",
  noDocToLearn:"Не бачу тексту для запам'ятовування. Встав його в повідомлення або додай файл.",
  forgotAll:"Пам'ять очищено.",
  forgotOne:"Забув ({n}): {x}",
  forgotNone:"Не знайшов у пам'яті нічого схожого на «{x}».",
  memEmpty:"Моя пам'ять поки порожня. Скажи «запам'ятай, що …» або «запам'ятай цей документ».",
  memHead:"Ось що я пам'ятаю:",
  memFacts:"Факти ({n})",memDocs:"Документи ({n})",memName:"Тебе звати {name}.",
  math:"**{expr} = {res}**",
  mathErr:"Не зміг порахувати цей вираз. Спробуй простіше, наприклад «(12+8)*3» або «15% від 240».",
  divZero:"На нуль ділити не можна.",
  unit:"**{a} {ua} = {b} {ub}**",
  today:"Сьогодні {wd}, {d} {m} {y} року.",
  time:"Зараз {t}.",
  weekdayOf:"{d} {m} {y} — це {wd}.",
  daysUntil:"До {d} {m} {y} ({wd}) залишилось {n} дн.",
  daysSince:"Від {d} {m} {y} минуло {n} дн.",
  daysToday:"Це сьогодні.",
  dateAfter:"Через {n} дн. буде {wd}, {d} {m} {y}.",
  noDate:"Не зрозумів дату. Напиши, наприклад, «25 грудня», «2026-12-25» або «завтра».",
  needText:"Для цього мені потрібен текст. Встав його в повідомлення, додай файл або спершу скажи «запам'ятай цей документ».",
  sum:"Коротко",kw:"Ключові слова",stats:"Статистика",dates:"Дати",nums:"Числа",acts:"Що треба зробити",tone:"Тон тексту",
  statsLine:"слів: {w} · речень: {s} · середнє речення: {a} слів · читабельність: {r}",
  noDates:"Дат у тексті не знайшов.",noNums:"Чисел у тексті не знайшов.",noActs:"Явних завдань у тексті не знайшов.",
  tonePos:"переважно позитивний",toneNeg:"переважно негативний",toneNeu:"нейтральний",
  ans:"Ось що знайшов",
  srcContext:"з доданого тексту",srcLast:"з останнього тексту в розмові",srcFacts:"з моєї пам'яті",srcNotes:"з твоїх нотаток",srcDoc:"з документа «{title}»",srcHelp:"з довідки AI Bridge",
  unsure:"Не впевнений, що це точна відповідь — ось найближче, що є:",
  cant:"На це я не можу відповісти сам: потрібної інформації немає ні в тексті, ні в моїй пам'яті, а вигадувати я не вмію.",
  cantHint:"Можеш: додати текст чи файл, де є відповідь · сказати «запам'ятай, що …» · або передати питання хмарному AI.",
  shorter:"Ще коротше:",more:"Докладніше:",noRefine:"Немає чого уточнювати — спершу постав питання або дай текст.",
  can:"Можу ще: **ключові слова** · **які дати** · **що треба зробити** · або постав питання за цим текстом."
},
ru:{
  hello:["Привет! Чем помочь?","Здравствуйте! Что сделать?","Привет! Я на месте — спрашивай."],
  helloName:"Привет, {name}! Чем помочь?",
  how:"Работаю исправно, спасибо. Всё считаю на этом устройстве, без интернета. Что сделать?",
  thanks:["Пожалуйста!","Рад помочь.","Обращайся."],
  bye:"До встречи!",
  who:"Я — Ядро AI Bridge: локальный помощник, который работает прямо на этом устройстве, без сервера и интернета. Я не нейросеть: считаю, ищу в текстах и в памяти, делаю резюме — и честно говорю, когда вопрос нужно передать облачному AI.",
  help:"Вот что я умею сам, без интернета:\n\n- **Считать:** «сколько будет 15% от 240», «(12+8)*3», «корень из 144»\n- **Переводить единицы:** «5 миль в км», «70 кг в фунты», «20 C в F»\n- **Даты и время:** «какое сегодня число», «сколько дней до 25 декабря»\n- **Работать с текстом:** вставь текст или добавь файл и скажи «подытожь», «ключевые слова», «какие даты», «что нужно сделать», «статистика»\n- **Отвечать на вопросы по тексту** — из файла, из последнего текста в разговоре или из памяти\n- **Помнить:** «запомни, что …», «запомни этот документ», «что ты помнишь», «забудь про …»\n- **Справка об AI Bridge:** «как добавить ключ», «что такое KV»\n\nЕсли вопрос мне не под силу — скажу прямо и предложу облачный AI.",
  remembered:"Запомнил: «{x}».",
  rememberedName:"Приятно познакомиться, {name}! Запомнил.",
  learnedDoc:"Изучил документ «{title}» ({n} предложений). Теперь можно задавать по нему вопросы — даже в новом разговоре.",
  docTooBig:"Документ слишком большой для памяти — сохранил первые {n} символов.",
  noDocToLearn:"Не вижу текста для запоминания. Вставь его в сообщение или добавь файл.",
  forgotAll:"Память очищена.",
  forgotOne:"Забыл ({n}): {x}",
  forgotNone:"Не нашёл в памяти ничего похожего на «{x}».",
  memEmpty:"Моя память пока пуста. Скажи «запомни, что …» или «запомни этот документ».",
  memHead:"Вот что я помню:",
  memFacts:"Факты ({n})",memDocs:"Документы ({n})",memName:"Тебя зовут {name}.",
  math:"**{expr} = {res}**",
  mathErr:"Не смог посчитать это выражение. Попробуй проще, например «(12+8)*3» или «15% от 240».",
  divZero:"На ноль делить нельзя.",
  unit:"**{a} {ua} = {b} {ub}**",
  today:"Сегодня {wd}, {d} {m} {y} года.",
  time:"Сейчас {t}.",
  weekdayOf:"{d} {m} {y} — это {wd}.",
  daysUntil:"До {d} {m} {y} ({wd}) осталось {n} дн.",
  daysSince:"С {d} {m} {y} прошло {n} дн.",
  daysToday:"Это сегодня.",
  dateAfter:"Через {n} дн. будет {wd}, {d} {m} {y}.",
  noDate:"Не понял дату. Напиши, например, «25 декабря», «2026-12-25» или «завтра».",
  needText:"Для этого мне нужен текст. Вставь его в сообщение, добавь файл или сначала скажи «запомни этот документ».",
  sum:"Кратко",kw:"Ключевые слова",stats:"Статистика",dates:"Даты",nums:"Числа",acts:"Что нужно сделать",tone:"Тон текста",
  statsLine:"слов: {w} · предложений: {s} · среднее предложение: {a} слов · читаемость: {r}",
  noDates:"Дат в тексте не нашёл.",noNums:"Чисел в тексте не нашёл.",noActs:"Явных задач в тексте не нашёл.",
  tonePos:"в основном позитивный",toneNeg:"в основном негативный",toneNeu:"нейтральный",
  ans:"Вот что нашёл",
  srcContext:"из добавленного текста",srcLast:"из последнего текста в разговоре",srcFacts:"из моей памяти",srcNotes:"из твоих заметок",srcDoc:"из документа «{title}»",srcHelp:"из справки AI Bridge",
  unsure:"Не уверен, что это точный ответ — вот ближайшее, что есть:",
  cant:"На это я не могу ответить сам: нужной информации нет ни в тексте, ни в моей памяти, а выдумывать я не умею.",
  cantHint:"Можно: добавить текст или файл с ответом · сказать «запомни, что …» · или передать вопрос облачному AI.",
  shorter:"Ещё короче:",more:"Подробнее:",noRefine:"Нечего уточнять — сначала задай вопрос или дай текст.",
  can:"Могу ещё: **ключевые слова** · **какие даты** · **что нужно сделать** · или задай вопрос по этому тексту."
},
en:{
  hello:["Hi! How can I help?","Hello! What should I do?","Hi! I'm here — ask away."],
  helloName:"Hi, {name}! How can I help?",
  how:"Running fine, thanks. Everything is computed on this device, no internet. What should I do?",
  thanks:["You're welcome!","Glad to help.","Any time."],
  bye:"See you!",
  who:"I'm the AI Bridge Core: a local assistant that runs right on this device, with no server and no internet. I'm not a neural network: I calculate, search texts and memory, summarize — and say honestly when a question should go to a cloud AI.",
  help:"Here is what I can do on my own, offline:\n\n- **Calculate:** \"what is 15% of 240\", \"(12+8)*3\", \"sqrt(144)\"\n- **Convert units:** \"5 miles to km\", \"70 kg to lb\", \"20 C to F\"\n- **Dates and time:** \"what's the date today\", \"how many days until December 25\"\n- **Work with text:** paste a text or attach a file and say \"summarize\", \"keywords\", \"what dates\", \"action items\", \"statistics\"\n- **Answer questions from text** — from a file, the last text in the conversation, or memory\n- **Remember:** \"remember that …\", \"remember this document\", \"what do you remember\", \"forget about …\"\n- **AI Bridge help:** \"how do I add a key\", \"what is KV\"\n\nIf a question is beyond me, I'll say so and suggest a cloud AI.",
  remembered:"Remembered: \"{x}\".",
  rememberedName:"Nice to meet you, {name}! Remembered.",
  learnedDoc:"Learned the document \"{title}\" ({n} sentences). You can now ask questions about it — even in a new conversation.",
  docTooBig:"The document is too large for memory — I kept the first {n} characters.",
  noDocToLearn:"I don't see any text to remember. Paste it into the message or attach a file.",
  forgotAll:"Memory cleared.",
  forgotOne:"Forgot ({n}): {x}",
  forgotNone:"Found nothing in memory similar to \"{x}\".",
  memEmpty:"My memory is empty so far. Say \"remember that …\" or \"remember this document\".",
  memHead:"Here is what I remember:",
  memFacts:"Facts ({n})",memDocs:"Documents ({n})",memName:"Your name is {name}.",
  math:"**{expr} = {res}**",
  mathErr:"I couldn't compute that expression. Try something simpler, like \"(12+8)*3\" or \"15% of 240\".",
  divZero:"Division by zero is not possible.",
  unit:"**{a} {ua} = {b} {ub}**",
  today:"Today is {wd}, {m} {d}, {y}.",
  time:"It is {t} now.",
  weekdayOf:"{m} {d}, {y} is a {wd}.",
  daysUntil:"{n} day(s) left until {m} {d}, {y} ({wd}).",
  daysSince:"{n} day(s) have passed since {m} {d}, {y}.",
  daysToday:"That's today.",
  dateAfter:"In {n} day(s) it will be {wd}, {m} {d}, {y}.",
  noDate:"I didn't understand the date. Try \"December 25\", \"2026-12-25\" or \"tomorrow\".",
  needText:"I need a text for that. Paste it into the message, attach a file, or first say \"remember this document\".",
  sum:"In short",kw:"Keywords",stats:"Statistics",dates:"Dates",nums:"Numbers",acts:"Action items",tone:"Tone",
  statsLine:"words: {w} · sentences: {s} · average sentence: {a} words · readability: {r}",
  noDates:"No dates found in the text.",noNums:"No numbers found in the text.",noActs:"No explicit action items found in the text.",
  tonePos:"mostly positive",toneNeg:"mostly negative",toneNeu:"neutral",
  ans:"Here is what I found",
  srcContext:"from the attached text",srcLast:"from the last text in this conversation",srcFacts:"from my memory",srcNotes:"from your notes",srcDoc:"from the document \"{title}\"",srcHelp:"from AI Bridge help",
  unsure:"I'm not sure this is the exact answer — here is the closest I have:",
  cant:"I can't answer this on my own: the information isn't in the text or in my memory, and I don't make things up.",
  cantHint:"You can: add a text or file that contains the answer · say \"remember that …\" · or send the question to a cloud AI.",
  shorter:"Even shorter:",more:"More detail:",noRefine:"Nothing to refine yet — ask a question or give me a text first.",
  can:"I can also do: **keywords** · **what dates** · **action items** · or ask a question about this text."
}};
/* Вбудована довідка про AI Bridge (щоб відповідати без мережі). q — слова для пошуку. */
const __A_HELP={
uk:[
 ["що таке ai bridge міст для чого сайт","AI Bridge — це приватний робочий простір, який надсилає одне завдання кільком моделям AI (Gemini, Groq, OpenRouter та інші), порівнює відповіді й збирає одну фінальну."],
 ["як додати ключ api токен провайдера підключити модель","Ключі провайдерів додаються на сторінці «Зв'язок»: встав ключ у поле потрібного провайдера і збережи. Серверні ключі зберігаються в Cloudflare Secrets, а ключі з телефона шифруються сервером."],
 ["що таке kv сховище навіщо ai_bridge_jobs","KV — це сховище Cloudflare. AI Bridge використовує простір AI_BRIDGE_JOBS, щоб не губити довгі завдання, синхронізувати історію між пристроями і захищати вхід. Додається в Cloudflare → Settings → Bindings."],
 ["режими auto agent god команда чим відрізняються","Режим Auto сам вибирає швидку справну модель. «Ask All» питає всі вибрані моделі. Agent сам планує кроки і користується інструментами. God Mode поєднує пошук, агента і перевірку відповіді."],
 ["чому помилка 503 gemini перевантажений модель недоступна","Помилка 503 означає, що модель тимчасово перевантажена на боці провайдера. Bridge сам переходить на іншу модель; зазвичай за кілька хвилин усе відновлюється."],
 ["помилка 429 ліміт квота закінчилась забагато запитів","Помилка 429 — це вичерпаний ліміт запитів у провайдера. Безкоштовні ліміти оновлюються щодня; на сторінці «Історія» є картка використання AI."],
 ["як оновити сайт стара версія кеш оновлення","Щоб побачити нову версію, натисни кнопку оновлення ↻ у шапці або закрий і відкрий вкладку. Після деплою в Cloudflare варто зробити Caching → Purge Everything."],
 ["синхронізація історії між пристроями телефон комп'ютер","Синхронізація історії вмикається перемикачем на сторінці «Історія». Історія зберігається у твоєму власному Cloudflare KV, за замовчуванням вимкнена."],
 ["ролі роль ai перекладач редактор","Роль додає твої інструкції до кожного запиту. Вибирається кнопкою 🎭 біля поля вводу; можна створити власну роль і призначити їй модель."],
 ["приватність де зберігаються дані безпека","Історія зберігається на цьому пристрої; ключі — у Cloudflare Secrets. Ядро працює повністю локально і нікуди нічого не надсилає."],
 ["самоперевірка діагностика перевірити сайт чи все працює","Самоперевірка запускається на сторінці «Зв'язок»: вона перевіряє версію, провайдерів, KV і безпеку й дає звіт, який можна скопіювати."],
 ["офлайн без інтернету що працює ядро","Без інтернету працює Ядро: рахунок, одиниці, дати, робота з текстом, пам'ять і довідка. Питання до хмарних моделей стають у чергу і надсилаються, коли з'явиться зв'язок."]
],
ru:[
 ["что такое ai bridge мост для чего сайт","AI Bridge — это приватное рабочее пространство, которое отправляет одну задачу нескольким моделям AI (Gemini, Groq, OpenRouter и другим), сравнивает ответы и собирает один финальный."],
 ["как добавить ключ api токен провайдера подключить модель","Ключи провайдеров добавляются на странице «Связь»: вставь ключ в поле нужного провайдера и сохрани. Серверные ключи хранятся в Cloudflare Secrets."],
 ["что такое kv хранилище зачем ai_bridge_jobs","KV — это хранилище Cloudflare. AI Bridge использует пространство AI_BRIDGE_JOBS, чтобы не терять долгие задачи, синхронизировать историю и защищать вход."],
 ["режимы auto agent god команда чем отличаются","Режим Auto сам выбирает быструю исправную модель. Agent сам планирует шаги и использует инструменты. God Mode сочетает поиск, агента и проверку ответа."],
 ["почему ошибка 503 gemini перегружен модель недоступна","Ошибка 503 означает, что модель временно перегружена на стороне провайдера. Bridge сам переходит на другую модель."],
 ["ошибка 429 лимит квота закончилась","Ошибка 429 — это исчерпанный лимит запросов у провайдера. Бесплатные лимиты обновляются каждый день."],
 ["как обновить сайт старая версия кеш","Чтобы увидеть новую версию, нажми кнопку обновления ↻ в шапке или закрой и открой вкладку."],
 ["офлайн без интернета что работает ядро","Без интернета работает Ядро: счёт, единицы, даты, работа с текстом, память и справка."]
],
en:[
 ["what is ai bridge what is it for site","AI Bridge is a private workspace that sends one task to several AI models (Gemini, Groq, OpenRouter and others), compares the answers and builds one final answer."],
 ["how add api key token provider connect model","Provider keys are added on the Connect page: paste the key into the provider's field and save. Server keys live in Cloudflare Secrets."],
 ["what is kv storage why ai_bridge_jobs","KV is Cloudflare storage. AI Bridge uses the AI_BRIDGE_JOBS namespace to keep long jobs, sync history between devices and protect sign-in."],
 ["modes auto agent god team difference","Auto picks a fast healthy model by itself. Agent plans steps and uses tools on its own. God Mode combines search, the agent and answer verification."],
 ["why error 503 gemini overloaded model unavailable","Error 503 means the model is temporarily overloaded on the provider side. Bridge switches to another model automatically."],
 ["error 429 rate limit quota exceeded","Error 429 means the provider's request limit is used up. Free limits reset daily."],
 ["how update site old version cache refresh","To see the new version, press the refresh button ↻ in the header or close and reopen the tab."],
 ["offline without internet what works core","Offline, the Core still works: math, units, dates, text tools, memory and help."]
]};
/* Одиниці: [вимір, множник до базової]. Температура — окремо. */
const __A_UNITS=(()=>{
  const m=new Map(),add=(dim,f,names)=>{for(const n of names.split(","))m.set(n,{dim,f})};
  add("len",1000,"км,km,кілометр,кілометри,кілометрів,километр,километра,километров,kilometer,kilometers,kilometre,kilometres");
  add("len",1,"м,m,метр,метри,метрів,метра,метров,meter,meters,metre,metres");
  add("len",0.01,"см,cm,сантиметр,сантиметри,сантиметрів,сантиметра,сантиметров,centimeter,centimeters");
  add("len",0.001,"мм,mm,міліметр,міліметри,міліметрів,миллиметр,миллиметра,миллиметров,millimeter,millimeters");
  add("len",1609.344,"миля,милі,миль,милю,мили,mi,mile,miles");
  add("len",0.3048,"фут,фути,футів,фута,футов,ft,foot,feet");
  add("len",0.0254,"дюйм,дюйми,дюймів,дюйма,дюймов,inch,inches");
  add("len",0.9144,"ярд,ярди,ярдів,ярда,ярдов,yd,yard,yards");
  add("mass",1,"кг,kg,кілограм,кілограми,кілограмів,килограмм,килограмма,килограммов,kilogram,kilograms");
  add("mass",0.001,"г,g,грам,грами,грамів,грамм,грамма,граммов,gram,grams");
  add("mass",0.45359237,"фунт,фунти,фунтів,фунта,фунтов,lb,lbs,pound,pounds");
  add("mass",0.028349523,"унція,унції,унцій,унция,унции,oz,ounce,ounces");
  add("mass",1000,"т,тонна,тонни,тонн,тонны,ton,tons,tonne,tonnes");
  add("vol",1,"л,l,літр,літри,літрів,литр,литра,литров,liter,liters,litre,litres");
  add("vol",0.001,"мл,ml,мілілітр,мілілітри,мілілітрів,миллилитр,миллилитра,миллилитров,milliliter,milliliters");
  add("vol",3.785411784,"галон,галони,галонів,галлон,галлона,галлонов,gal,gallon,gallons");
  add("vol",0.2365882365,"чашка,чашки,чашок,cup,cups");
  add("spd",1,"км/год,км/ч,km/h,kmh,kph");
  add("spd",1.609344,"миль/год,миль/ч,mph");
  add("temp",0,"c,°c,с,°с,цельсій,цельсія,цельсий,цельсия,celsius");
  add("temp",1,"f,°f,ф,°ф,фаренгейт,фаренгейта,fahrenheit");
  add("temp",2,"k,к,кельвін,кельвіна,кельвин,кельвина,kelvin");
  return m;
})();
function __aFmtNum(x){
  if(!Number.isFinite(x))return String(x);
  const r=Math.abs(x)>=1e15||(Math.abs(x)<1e-9&&x!==0)?x.toExponential(6):String(+x.toPrecision(12));
  if(/e/.test(r))return r;
  const [i,f]=r.split(".");
  const ii=i.replace(/\B(?=(\d{3})+(?!\d))/g," ");
  return f?ii+"."+f.slice(0,8).replace(/0+$/,"").replace(/^$/,"0"):ii;
}
/* ---- Безпечний калькулятор (рекурсивний спуск, без eval) ---- */
function __aCalc(src){
  let s=String(src).toLowerCase().slice(0,200);
  s=s.replace(/помножити\s+на|умножить\s+на|множити\s+на|times|multiplied\s+by/g,"*")
     .replace(/поділити\s+на|разделить\s+на|ділити\s+на|divided\s+by|over/g,"/")
     .replace(/плюс|plus/g,"+").replace(/мінус|минус|minus/g,"-")
     .replace(/в\s+степені|у\s+степені|в\s+степени|to\s+the\s+power\s+of/g,"^")
     .replace(/корінь\s+(?:квадратний\s+)?(?:з|із)|корень\s+(?:квадратный\s+)?из|square\s+root\s+of|sqrt/g,"√")
     .replace(/[×xх](?=\s*\d)/g,"*").replace(/÷|\s:\s/g,"/").replace(/−|–|—/g,"-").replace(/\*\*/g,"^");
  {
    const po=s.replace(/[?=\s]+$/,"").match(/^\s*(\d+(?:[.,]\d+)?)\s*(?:%|відсотк[а-яіїє]*|процент[а-я]*|percent)\s*(?:від|от|of)\s*(\d[\d\s]*(?:[.,]\d+)?)\s*$/);
    if(po){const a=parseFloat(po[1].replace(",",".")),b=parseFloat(po[2].replace(/\s/g,"").replace(",","."));if(Number.isFinite(a)&&Number.isFinite(b))return{ok:true,value:a/100*b,expr:po[1]+"% × "+po[2].trim()}}
  }
  /* «15% від 240» → (15/100)*240 */
  s=s.replace(/(\d+(?:[.,]\d+)?)\s*(?:%|відсотк[а-яіїє]*|процент[а-я]*|percent)\s*(?:від|от|of)\s*(\d[\d\s]*(?:[.,]\d+)?)/g,"($1/100*$2)");
  s=s.replace(/відсотк[а-яіїє]*|процент[а-я]*|percent/g,"%");
  /* числа: «1 000», «1,5», «1,000.5» */
  s=s.replace(/(\d)\s+(?=\d{3}(?!\d))/g,"$1");
  s=s.replace(/(?<![\d.,])\d{1,3}(?:,\d{3})+(?![\d,])/g,(m)=>m.replace(/,/g,""));   /* 1,000,000 → 1000000 */
  s=s.replace(/(\d),(\d)/g,"$1.$2");                                                /* 1,5 → 1.5 */
  s=s.replace(/\s+/g,"");
  if(!s||!/\d/.test(s)||/[^0-9.+\-*/^()%√]/.test(s))return{ok:false};
  if(!/[+\-*/^%√]/.test(s.replace(/^-/,"")))return{ok:false};
  let i=0,depth=0;
  const peek=()=>s.charAt(i);
  function num(){
    const st=i;while(/[0-9.]/.test(peek()))i++;
    const t=s.slice(st,i);
    if(!t||(t.match(/\./g)||[]).length>1)throw new Error("num");
    return parseFloat(t);
  }
  function primary(){
    if(++depth>60)throw new Error("deep");
    let v,pct=false;
    if(peek()==="("){i++;v=expr().v;if(peek()!==")")throw new Error("paren");i++;}
    else if(peek()==="√"){i++;const a=primary().v;if(a<0)throw new Error("sqrt");v=Math.sqrt(a);}
    else v=num();
    if(peek()==="%"){i++;v=v/100;pct=true;}
    depth--;
    return{v,pct};
  }
  function unary(){if(peek()==="-"){i++;const r=unary();return{v:-r.v,pct:r.pct}}if(peek()==="+"){i++;return unary()}return primary()}
  function power(){const b=unary();if(peek()==="^"){i++;const e=power();return{v:Math.pow(b.v,e.v),pct:false}}return b}
  function term(){
    let l=power();
    while(peek()==="*"||peek()==="/"){
      const op=s.charAt(i++),r=power();
      if(op==="/"&&r.v===0)throw new Error("div0");
      l={v:op==="*"?l.v*r.v:l.v/r.v,pct:false};
    }
    return l;
  }
  function expr(){
    let l=term();
    while(peek()==="+"||peek()==="-"){
      const op=s.charAt(i++),r=term();
      const add=r.pct?l.v*r.v:r.v;           /* «200 + 10%» = 220 */
      l={v:op==="+"?l.v+add:l.v-add,pct:false};
    }
    return l;
  }
  try{
    const r=expr();
    if(i<s.length)return{ok:false};
    if(!Number.isFinite(r.v))return{ok:false};
    return{ok:true,value:r.v,expr:s.replace(/√/g,"√").replace(/\*/g," × ").replace(/\//g," ÷ ").replace(/\+/g," + ").replace(/(?<=[\d)%])-/g," − ").replace(/\^/g,"^")};
  }catch(e){return{ok:false,div0:e.message==="div0"}}
}
/* ---- Розбір дати. Повертає Date (локальна північ) або null. ---- */
function __aParseDate(str,now){
  const s=String(str).toLowerCase();
  const mk=(y,m,d)=>{const dt=new Date(y,m,d);return(dt.getFullYear()===y&&dt.getMonth()===m&&dt.getDate()===d)?dt:null};
  const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  if(/післязавтра|послезавтра|day after tomorrow/.test(s))return new Date(today.getFullYear(),today.getMonth(),today.getDate()+2);
  if(/завтра|tomorrow/.test(s))return new Date(today.getFullYear(),today.getMonth(),today.getDate()+1);
  if(/позавчора|позавчера/.test(s))return new Date(today.getFullYear(),today.getMonth(),today.getDate()-2);
  if(/вчора|вчера|yesterday/.test(s))return new Date(today.getFullYear(),today.getMonth(),today.getDate()-1);
  if(/нов(ого|ий|ому)\s+р(оку|ік|оком)|нового\s+года|новый\s+год|new\s+year/.test(s))return new Date(today.getFullYear()+1,0,1);
  let m=s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if(m)return mk(+m[1],+m[2]-1,+m[3]);
  m=s.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if(m)return mk(+m[3],+m[2]-1,+m[1]);
  const monthOf=(w)=>{for(let k=0;k<12;k++)for(const st of __A_MONTH_STEMS[k])if(w.startsWith(st))return k;return -1};
  const nextOcc=(mo,d,y)=>{
    if(y)return mk(y,mo,d);
    let dt=mk(today.getFullYear(),mo,d);
    if(dt&&dt<today)dt=mk(today.getFullYear()+1,mo,d);
    return dt;
  };
  m=s.match(/(\d{1,2})(?:-?(?:го|ого|е|th|st|nd|rd))?\s+([a-zа-яіїєґ']{3,})\.?(?:\s+(\d{4}))?/);
  if(m){const mo=monthOf(m[2]);if(mo>=0)return nextOcc(mo,+m[1],m[3]?+m[3]:0)}
  m=s.match(/([a-zа-яіїєґ']{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/);
  if(m){const mo=monthOf(m[1]);if(mo>=0)return nextOcc(mo,+m[2],m[3]?+m[3]:0)}
  return null;
}
function __aPick(arr,seed){
  if(!Array.isArray(arr))return arr;
  let h=0;const k=String(seed||"");for(let i=0;i<k.length;i++)h=(h*31+k.charCodeAt(i))>>>0;
  return arr[h%arr.length];
}
function __aFill(tpl,vars){return String(tpl).replace(/\{(\w+)\}/g,(m,k)=>vars&&vars[k]!==undefined?String(vars[k]):m)}
/* Оцінені кандидати відповіді: [{s,score,coverage}] за спаданням оцінки. */
/* Питальні й службові слова не є змістом питання: «what is the garage code» → garage, code. */
const __A_QWORDS=new Set("what,whats,which,who,whom,whose,when,where,why,how,does,did,are,was,were,can,could,will,would,should,tell,show,give,please,about,mean,means,що,шо,хто,як,де,куди,звідки,коли,чому,навіщо,який,яка,яке,які,якого,якій,яку,яким,скільки,таке,такий,розкажи,покажи,скажи,підкажи,будь,ласка,означає,значить,что,кто,как,где,куда,откуда,когда,почему,зачем,какой,какая,какое,какие,какого,какую,сколько,такое,такой,расскажи,покажи,скажи,подскажи,пожалуйста,означает,значит,my,mine,our,name,named,called,мій,мого,моя,моєї,моїй,мою,моє,мої,моїх,моїм,моєму,наш,наша,наше,наші,звати,звуть,зветься,називається,називаються,мой,моего,моей,мое,моё,мои,моих,моим,моему,зовут,называется,называются".split(","));
/* Чергування і↔о/е в українських коренях: кіт/кота, рік/року, ніч/ночі, піч/печі. Лише для коротких слів. */
function __aMatch(a,b){
  if(stemMatch(a,b))return true;
  if(a.length>7||b.length>7)return false;
  const ia=a.indexOf("і")>=0,ib=b.indexOf("і")>=0;
  if(ia===ib)return false;
  const x=ia?a:b,y=ia?b:a;
  if(x.length<3||y.length<3||x[0]!==y[0])return false;
  return stemMatch(x.replace("і","о"),y)||stemMatch(x.replace("і","е"),y);
}
function __aQTokens(question){
  const all=[...new Set(tokenizeQA(question))];
  const core=all.filter(w=>!__A_QWORDS.has(w));
  return core.length?core:all;
}
function __aScored(question,text,n){
  const qTokens=__aQTokens(question);
  if(!qTokens.length||!text)return[];
  const sentences=splitSentences(text);
  if(!sentences.length)return[];
  const docs=sentences.map(s=>({s,toks:tokenizeQA(s)}));
  const N=docs.length,avgdl=Math.max(1,docs.reduce((a,d)=>a+d.toks.length,0)/N),k1=1.2,b=0.75;
  const idf=qTokens.map(q=>{let df=0;for(const d of docs)if(d.toks.some(w=>__aMatch(q,w)))df++;return df?Math.log((N-df+0.5)/(df+0.5)+1):0});
  const qType=__questionType(question),out=[];
  for(let i=0;i<docs.length;i++){
    const d=docs[i];if(!d.toks.length)continue;
    let score=0,matched=0;
    for(let qi=0;qi<qTokens.length;qi++){
      let tf=0;for(const w of d.toks)if(__aMatch(qTokens[qi],w))tf++;
      if(!tf)continue;
      matched++;
      score+=(idf[qi]||0.1)*(tf*(k1+1))/(tf+k1*(1-b+b*(d.toks.length/avgdl)));
    }
    if(!matched)continue;
    const coverage=matched/qTokens.length;
    score*=1+coverage;
    if(qType&&qType.re.test(d.s))score*=1.3;
    out.push({i,s:d.s,score,coverage});
  }
  out.sort((a,b2)=>b2.score-a.score||a.i-b2.i);
  const seen=new Set(),top=[];
  for(const x of out){const key=x.s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();if(seen.has(key))continue;seen.add(key);top.push(x);if(top.length>=(n||3))break}
  return top;
}
const __A_ACTION_RE=/(?:^|[^\p{L}])(треба|потрібно|необхідно|слід|мушу|мусимо|мусить|має|маємо|мають|зроби|підготу|надішли|замов|перевір|нагадай|не забудь|до\s+(?:понеділка|вівторка|середи|четверга|п['’ʼ]ятниці|суботи|неділі|завтра|кінця)|нужно|надо|необходимо|следует|должен|должна|должны|сделай|подготов|отправ|закаж|провер|не забудь|must|should|need(?:s)? to|have to|has to|todo|to-do|action|deadline|due|please\s+\w+|don['’]t forget)(?![\p{L}])/iu;

function createAssistant(opts){
  const o=(opts&&typeof opts==="object")?opts:{};
  const nowFn=typeof o.now==="function"?o.now:()=>new Date();
  const mem={facts:[],docs:[],prefs:{}};
  let notes=[];                     /* зовнішні нотатки застосунку (лише читання) */
  let last={text:"",reply:"",hits:[],question:"",intent:"",source:null};
  let seq=0;
  const L=(lang)=>__A_T[lang]||__A_T.uk;
  const langOf=(text)=>{
    const forced=o.lang;
    const t=String(text||"");
    if(t.replace(/[^\p{L}]/gu,"").length<3)return (forced==="ru"||forced==="en"||forced==="uk")?forced:"uk";
    const d=detectLang(t);
    /* дуже короткі кириличні фрази без маркерів — мова інтерфейсу */
    if(d==="uk"&&forced==="ru"&&!/[іїєґ]/i.test(t)&&t.length<25)return "ru";
    return d;
  };
  const out=(intent,text,extra)=>{
    const r=Object.assign({text,intent,confidence:1,handled:true,escalate:false,sources:[],lang:"uk"},extra||{});
    last.reply=text;last.intent=intent;
    return r;
  };
  function importMemory(json){
    try{
      const d=typeof json==="string"?JSON.parse(json):json;
      if(!d||typeof d!=="object")return false;
      mem.facts=(Array.isArray(d.facts)?d.facts:[]).filter(f=>f&&typeof f.text==="string"&&f.text.trim()).slice(-__A_LIM.facts).map(f=>({id:String(f.id||("f"+(++seq))),text:f.text.slice(0,__A_LIM.factChars),ts:Number(f.ts)||0}));
      mem.docs=[];let total=0;
      for(const dd of (Array.isArray(d.docs)?d.docs:[]).slice(-__A_LIM.docs)){
        if(!dd||typeof dd.text!=="string"||!dd.text.trim())continue;
        const text=dd.text.slice(0,__A_LIM.docChars);
        if(total+text.length>__A_LIM.totalDocChars)break;
        total+=text.length;
        mem.docs.push({id:String(dd.id||("d"+(++seq))),title:String(dd.title||"").slice(0,120)||"—",text,ts:Number(dd.ts)||0});
      }
      mem.prefs={};
      if(d.prefs&&typeof d.prefs.name==="string")mem.prefs.name=d.prefs.name.slice(0,40);
      return true;
    }catch(e){return false}
  }
  function exportMemory(){return JSON.stringify({v:1,facts:mem.facts,docs:mem.docs,prefs:mem.prefs})}
  function memoryInfo(){return{facts:mem.facts.length,docs:mem.docs.length,docChars:mem.docs.reduce((a,d)=>a+d.text.length,0),name:mem.prefs.name||null,notes:notes.length}}
  function remember(text){
    const t=String(text||"").replace(/\s+/g," ").trim().slice(0,__A_LIM.factChars);
    if(!t)return null;
    const key=t.toLowerCase();
    mem.facts=mem.facts.filter(f=>f.text.toLowerCase()!==key);
    const f={id:"f"+nowFn().getTime().toString(36)+(++seq),text:t,ts:nowFn().getTime()};
    mem.facts.push(f);
    if(mem.facts.length>__A_LIM.facts)mem.facts=mem.facts.slice(-__A_LIM.facts);
    return f;
  }
  function learn(text,title){
    let t=guardInput(text).trim();
    if(!t)return null;
    let truncated=false;
    if(t.length>__A_LIM.docChars){t=t.slice(0,__A_LIM.docChars);truncated=true}
    let ttl=String(title||"").replace(/\s+/g," ").trim().slice(0,120);
    if(!ttl){const f=(splitSentences(t)[0]||"").replace(/[.!?…]+$/,"");ttl=f.length>48?f.slice(0,f.lastIndexOf(" ",48)>20?f.lastIndexOf(" ",48):48)+"…":(f||"—")}
    mem.docs=mem.docs.filter(d=>d.title!==ttl);
    mem.docs.push({id:"d"+nowFn().getTime().toString(36)+(++seq),title:ttl,text:t,ts:nowFn().getTime()});
    while(mem.docs.length>__A_LIM.docs||mem.docs.reduce((a,d)=>a+d.text.length,0)>__A_LIM.totalDocChars)mem.docs.shift();
    return{title:ttl,sentences:splitSentences(t).length,truncated,chars:t.length};
  }
  function forget(query){
    const q=String(query||"").trim();
    if(!q||/^(все|всё|усе|everything|all|пам['’ʼ]?ять|память|memory)$/i.test(q)){
      const n=mem.facts.length+mem.docs.length;mem.facts=[];mem.docs=[];mem.prefs={};return{all:true,n};
    }
    const qt=[...new Set(tokenizeQA(q))];
    if(!qt.length)return{all:false,n:0,removed:[]};
    const hit=(text)=>{const tk=tokenizeQA(text);let m=0;for(const a of qt)if(tk.some(w=>__aMatch(a,w)))m++;return m/qt.length>=0.6};
    const removed=[];
    mem.facts=mem.facts.filter(f=>{if(hit(f.text)){removed.push(f.text);return false}return true});
    mem.docs=mem.docs.filter(d=>{if(hit(d.title)){removed.push("«"+d.title+"»");return false}return true});
    return{all:false,n:removed.length,removed};
  }
  function setNotes(list){
    notes=(Array.isArray(list)?list:[]).map(x=>typeof x==="string"?x:(x&&(x.text||x.body||x.title)||"")).map(x=>String(x).trim()).filter(Boolean).slice(-__A_LIM.notes);
  }
  if(o.memory)importMemory(o.memory);
  if(o.notes)setNotes(o.notes);

  /* ---------- інструменти над текстом ---------- */
  function textTools(text,want,T,lang){
    const parts=[];
    const pub=__publicRef||{};
    if(want.sum){const sm=summarize(text,want.sumN||3);if(sm.length)parts.push("### "+T.sum+"\n\n"+sm.map(s=>"- "+s).join("\n"))}
    if(want.kw){const k=keywords(text,10);if(k.length)parts.push("### "+T.kw+"\n\n"+k.map(x=>x.word+" ("+x.count+")").join(" · "))}
    if(want.acts){
      const a=[...new Set(splitSentences(text).filter(s=>__A_ACTION_RE.test(s)&&s.length<=300))].slice(0,12);
      parts.push("### "+T.acts+"\n\n"+(a.length?a.map(s=>"- [ ] "+s).join("\n"):T.noActs));
    }
    if(want.dates||want.nums){
      let dn={dates:[],numbers:[]};
      try{if(typeof pub.extractDatesNumbers==="function")dn=pub.extractDatesNumbers(text)||dn}catch(e){}
      if(want.dates){
        const ds=[...new Set((dn.dates||[]).map(d=>d.raw).filter(Boolean))].slice(0,20);
        /* речення, де згадано дату, — щоб було видно, ЩО відбувається цього дня */
        const sents=splitSentences(text);
        const lines=ds.map(d=>{const s=sents.find(x=>x.includes(d));return "- **"+d+"**"+(s&&s.length<=220?" — "+s:"")});
        parts.push("### "+T.dates+"\n\n"+(lines.length?lines.join("\n"):T.noDates));
      }
      if(want.nums){
        const ns=[...new Set((dn.numbers||[]).map(x=>x.raw).filter(x=>x&&x!=="00"))].slice(0,30);
        parts.push("### "+T.nums+"\n\n"+(ns.length?ns.join(" · "):T.noNums));
      }
    }
    if(want.stats){
      const st=stats(text);let rd="—";
      try{if(typeof pub.readability==="function"){const r=pub.readability(text);if(r&&r.level)rd=r.level}}catch(e){}
      parts.push("### "+T.stats+"\n\n"+__aFill(T.statsLine,{w:st.words,s:st.sentences,a:st.avgSentenceLen,r:rd}));
    }
    if(want.tone){
      let lab=T.toneNeu;
      try{if(typeof pub.sentiment==="function"){const s=pub.sentiment(text);if(s&&s.label==="positive")lab=T.tonePos;else if(s&&s.label==="negative")lab=T.toneNeg}}catch(e){}
      parts.push("### "+T.tone+"\n\n"+lab);
    }
    return parts.join("\n\n");
  }

  /* ---------- пошук відповіді в усіх джерелах ---------- */
  function findAnswer(question,ctxText,T,lang){
    const cands=[];
    const push=(type,title,text,bias)=>{
      if(!text)return;
      const hits=__aScored(question,text,3);
      if(!hits.length)return;
      const qn=__aQTokens(question).length||1;
      const best=hits[0];
      /* впевненість: частка знайдених слів питання + сила збігу */
      const conf=Math.min(1,best.coverage*0.75+Math.min(1,best.score/(qn*1.6))*0.25)*(bias||1);
      cands.push({type,title,hits,conf});
    };
    if(ctxText)push("context","",ctxText,1.05);
    if(last.text&&last.text!==ctxText)push("last","",last.text,1.0);
    if(mem.facts.length)push("facts","",mem.facts.map(f=>f.text.replace(/\s*\n+\s*/g," ")).join("\n\n"),1.0);
    if(notes.length)push("notes","",notes.map(n=>n.replace(/\s*\n+\s*/g," ")).join("\n\n"),0.97);
    for(const d of mem.docs)push("doc",d.title,d.text,0.98);
    const help=(__A_HELP[lang]||__A_HELP.uk);
    {
      /* довідка: шукаємо за словами-ключами запису, відповідаємо його текстом */
      const qt=__aQTokens(question);
      let bestH=null,bestC=0;
      for(const [keys,ans] of help){
        const kt=tokenizeQA(keys+" "+ans);let m=0;
        for(const a of qt)if(kt.some(w=>__aMatch(a,w)))m++;
        const c=qt.length?m/qt.length:0;
        if(c>bestC){bestC=c;bestH=ans}
      }
      if(bestH&&bestC>=0.5)cands.push({type:"help",title:"",hits:[{s:bestH,score:bestC,coverage:bestC}],conf:Math.min(1,bestC)*0.9});
    }
    cands.sort((a,b2)=>b2.conf-a.conf);
    return cands[0]||null;
  }
  function srcLabel(c,T){
    if(c.type==="context")return T.srcContext;
    if(c.type==="last")return T.srcLast;
    if(c.type==="facts")return T.srcFacts;
    if(c.type==="notes")return T.srcNotes;
    if(c.type==="doc")return __aFill(T.srcDoc,{title:c.title});
    return T.srcHelp;
  }

  /* ---------- головна функція ---------- */
  function respond(input,ctx){
    const raw=guardInput(input).trim();
    const c=(ctx&&typeof ctx==="object")?ctx:{};
    const ctxText=typeof c.context==="string"?c.context.trim():"";
    if(ctxText)guardInput(ctxText);
    const lang=langOf(raw||ctxText);
    const T=L(lang);
    const ret=(intent,text,extra)=>out(intent,text,Object.assign({lang},extra||{}));
    if(!raw&&!ctxText)return ret("empty",T.needText,{handled:false});
    /* прибрати вітання на початку, якщо далі є зміст */
    let q=raw;
    const greetRe=/^\s*(?:привіт(?:ик)?|вітаю|добр(?:ий|ого)\s+(?:день|дня|вечір|вечора|ранок|ранку)|доброго\s+ранку|здоров(?:енькі)?\s*були?|хай|hello|hi|hey|good\s+(?:morning|evening|afternoon)|привет|здравствуй(?:те)?|добр(?:ый|ое|ого)\s+(?:день|вечер|утро))(?![\p{L}])[\s,!.]*/iu;
    const gm=q.match(greetRe);
    const greeted=!!gm;
    if(gm&&q.slice(gm[0].length).trim().length>2)q=q.slice(gm[0].length).trim();
    /* наміри шукаємо лише на початку довгого повідомлення (решта — це текст для роботи);
       так регулярні вирази ніколи не бігають по сотнях тисяч символів */
    const qi=q.length>600?q.slice(0,300):q;
    const low=qi.toLowerCase();
    const words=q.length>600?999:(low.match(/[\p{L}\p{N}']+/gu)||[]).length;

    /* 1. ім'я */
    let m=qi.match(/(?:мене\s+звати|моє\s+ім['’ʼ]?я|my\s+name\s+is|меня\s+зовут|моё\s+имя|мое\s+имя)[\s:—-]+([\p{L}][\p{L}'’ʼ-]{1,30})/iu);
    if(m&&words<=6){const nm=m[1].charAt(0).toUpperCase()+m[1].slice(1);mem.prefs.name=nm;return ret("name",__aFill(T.rememberedName,{name:nm}),{memoryChanged:true})}

    /* 2. пам'ять: показати */
    if(/(?:що|шо)\s+ти\s+(?:пам['’ʼ]?ятаєш|запам['’ʼ]?ятав)|покажи\s+пам['’ʼ]?ять|твоя\s+пам['’ʼ]?ять|what\s+do\s+you\s+remember|show\s+(?:your\s+)?memory|что\s+ты\s+(?:помнишь|запомнил)|покажи\s+память/iu.test(low)&&words<=8){
      if(!mem.facts.length&&!mem.docs.length&&!mem.prefs.name)return ret("memory.list",T.memEmpty);
      const parts=[T.memHead];
      if(mem.prefs.name)parts.push(__aFill(T.memName,{name:mem.prefs.name}));
      if(mem.facts.length)parts.push("**"+__aFill(T.memFacts,{n:mem.facts.length})+"**\n"+mem.facts.slice(-12).map(f=>"- "+f.text).join("\n"));
      if(mem.docs.length)parts.push("**"+__aFill(T.memDocs,{n:mem.docs.length})+"**\n"+mem.docs.map(d=>"- «"+d.title+"» ("+d.text.length+")").join("\n"));
      return ret("memory.list",parts.join("\n\n"));
    }
    /* 3. пам'ять: забути */
    m=qi.match(/^(?:забудь|видали\s+з\s+пам['’ʼ]?яті|зітри|forget|delete\s+from\s+memory|erase|удали\s+из\s+памяти|сотри)(?:\s+(?:про|about|о|об|that|що|что))?\s*(.*)$/isu);
    if(m){
      const r=forget(m[1].replace(/[.!?]+$/,""));
      if(r.all)return ret("memory.forget",T.forgotAll,{memoryChanged:true});
      if(r.n)return ret("memory.forget",__aFill(T.forgotOne,{n:r.n,x:r.removed.slice(0,3).join("; ")}),{memoryChanged:true});
      return ret("memory.forget",__aFill(T.forgotNone,{x:m[1].trim()}));
    }
    /* 4. пам'ять: вивчити документ / запам'ятати факт */
    m=qi.match(/^(?:будь\s+ласка,?\s*|please,?\s*|пожалуйста,?\s*)?(запам['’ʼ]?ятай|вивчи|прочитай\s+і\s+запам['’ʼ]?ятай|запиши|занотуй|збережи|remember|learn|memorize|note|save|запомни|изучи|сохрани)(?![\p{L}])[\s,:]*/iu);
    if(m){
      let payload=q.slice(m[0].length).trim();
      const ph=payload.slice(0,80);
      const aboutDoc=/^(?:цей|це|цю|ось|this|the|этот|это|эту)?\s*(?:текст|документ|файл|статтю|text|document|file|article|статью)?[.!]?$/iu.test(ph)||/^(?:цей|це|this|этот|это)\s+(?:текст|документ|файл|text|document|file)/iu.test(ph);
      const afterColon=payload.length>5000?payload:payload.replace(/^(?:цей|це|this|этот|это)?\s*(?:текст|документ|файл|text|document|file)?\s*[:\n]\s*/iu,"");
      if(aboutDoc||payload.length>__A_LIM.factChars||afterColon.length>__A_LIM.factChars){
        const body=ctxText||(afterColon.length>=80?afterColon:"")||(aboutDoc?last.text:"");
        if(!body)return ret("memory.learn",T.noDocToLearn,{handled:false});
        const r=learn(body,c.title);
        last.text=body;
        return ret("memory.learn",__aFill(T.learnedDoc,{title:r.title,n:r.sentences})+(r.truncated?"\n\n"+__aFill(T.docTooBig,{n:r.chars}):""),{memoryChanged:true});
      }
      payload=payload.replace(/^(?:що|шо|that|что|собі|себе|,)\s+/iu,"").replace(/^[:,\s]+/,"");
      if(payload.length>=2){const f=remember(payload);return ret("memory.remember",__aFill(T.remembered,{x:f.text}),{memoryChanged:true})}
    }

    /* 5. рахунок */
    {
      const stripped=low.replace(/^(?:скільки\s+буде|скільки\s+це|порахуй|обчисли|розрахуй|calculate|compute|what\s+is|what['’]s|how\s+much\s+is|сколько\s+будет|сколько\s+это|посчитай|вычисли)\s*/u,"").replace(/[?=\s]+$/,"");
      const looksMath=/\d/.test(stripped)&&(/^[\d\s.,+\-*/×÷^()%√:x−–]+$/.test(stripped)||/(?:%|відсотк|процент|percent)\s*(?:від|от|of)\s*\d|плюс|мінус|минус|помножити|умножить|поділити|разделить|корінь|корень|sqrt|square\s+root|в\s+степен|times|plus|minus|divided/.test(stripped));
      if(/\d:\d/.test(stripped)){/* 10:30 — це час, а не ділення */}
      else if(looksMath&&!/\d{1,2}[:.]\d{2}\s*$/.test(stripped.replace(/\s/g,""))||(/^[\d\s.,+\-*/×÷^()%√x−–]+$/.test(stripped)&&/[+\-*/×÷^%√]/.test(stripped))){
        const r=__aCalc(stripped);
        if(r.ok)return ret("math",__aFill(T.math,{expr:r.expr,res:__aFmtNum(r.value)}),{value:r.value});
        if(r.div0)return ret("math",T.divZero);
        if(/^[\d\s.,+\-*/×÷^()%√:x−–]+$/.test(stripped))return ret("math",T.mathErr,{handled:false});
      }
    }
    /* 6. одиниці */
    m=qi.match(/(-?\d+(?:[.,]\d+)?)\s*(°?[a-zа-яіїє]+(?:\/[a-zа-яіїє]+)?)\.?\s+(?:в|у|до|to|in|into|=|→|->)\s+(°?[a-zа-яіїє]+(?:\/[a-zа-яіїє]+)?)/iu);
    if(m){
      const a=parseFloat(m[1].replace(",",".")),ua=__A_UNITS.get(m[2].toLowerCase()),ub=__A_UNITS.get(m[3].toLowerCase());
      if(ua&&ub&&ua.dim===ub.dim){
        let b;
        if(ua.dim==="temp"){
          const k=ua.f===0?a+273.15:(ua.f===1?(a-32)*5/9+273.15:a);
          b=ub.f===0?k-273.15:(ub.f===1?(k-273.15)*9/5+32:k);
        }else b=a*ua.f/ub.f;
        return ret("units",__aFill(T.unit,{a:__aFmtNum(a),ua:m[2],b:__aFmtNum(+b.toPrecision(6)),ub:m[3]}),{value:b});
      }
    }
    /* 7. дати й час */
    {
      const now=nowFn();
      const fmt=(d,tpl,extra)=>__aFill(tpl,Object.assign({d:d.getDate(),m:__A_MONTHS[lang][d.getMonth()],y:d.getFullYear(),wd:__A_DAYS[lang][d.getDay()]},extra||{}));
      const today0=new Date(now.getFullYear(),now.getMonth(),now.getDate());
      if(/котра\s+година|котра\s+зараз|скільки\s+(?:зараз\s+)?(?:часу|годин)\b|what\s+time|current\s+time|который\s+час|сколько\s+(?:сейчас\s+)?времени/u.test(low))
        return ret("time",__aFill(T.time,{t:String(now.getHours()).padStart(2,"0")+":"+String(now.getMinutes()).padStart(2,"0")}));
      m=low.match(/(?:скільки|сколько|how\s+many)\s+(?:днів|дней|days)\s+(?:залишилось\s+|осталось\s+|left\s+)?(?:до|until|till|to|before)\s+(.+)/u);
      if(m){
        const d=__aParseDate(m[1],now);
        if(!d)return ret("date",T.noDate,{handled:false});
        const n=Math.round((d-today0)/86400000);
        return ret("date",n===0?T.daysToday:(n>0?fmt(d,T.daysUntil,{n}):fmt(d,T.daysSince,{n:-n})),{value:n});
      }
      m=low.match(/(?:скільки|сколько|how\s+many)\s+(?:днів|дней|days)\s+(?:минуло\s+|прошло\s+|have\s+passed\s+|passed\s+)?(?:від|з|с|от|since|from)\s+(.+)/u);
      if(m){
        const d=__aParseDate(m[1],now);
        if(!d)return ret("date",T.noDate,{handled:false});
        const n=Math.round((today0-d)/86400000);
        return ret("date",n===0?T.daysToday:(n>0?fmt(d,T.daysSince,{n}):fmt(d,T.daysUntil,{n:-n})),{value:n});
      }
      m=low.match(/через\s+(\d{1,4})\s*(дн|ден|доб|тижн|недел)|in\s+(\d{1,4})\s*(day|week)/u);
      if(m&&/(?:яке|яка|який|what|какое|какая|какой|буде|будет|will)/u.test(low)){
        const n=(+(m[1]||m[3]))*(/тижн|недел|week/.test(m[2]||m[4])?7:1);
        const d=new Date(today0.getFullYear(),today0.getMonth(),today0.getDate()+n);
        return ret("date",fmt(d,T.dateAfter,{n}));
      }
      m=low.match(/(?:який|якого|what|какой|в\s+какой)\s+(?:день\s+тижня|day\s+of\s+the\s+week|weekday|день\s+недели)\s*(?:буде|був|is|was|будет|был|припадає\s+на|on)?\s*(.*)$/u);
      if(m){
        const rest=m[1].replace(/[?.!]+$/,"").trim();
        if(!rest||/^(?:сьогодні|today|сегодня)$/u.test(rest))return ret("date",fmt(today0,T.today));
        const d=__aParseDate(rest,now);
        if(d)return ret("date",fmt(d,T.weekdayOf));
        return ret("date",T.noDate,{handled:false});
      }
      if(/(?:яке|який)\s+сьогодні\s+(?:число|день)|сьогоднішн[яю]\s+дат|яка\s+сьогодні\s+дата|what(?:['’]s|\s+is)\s+(?:the\s+)?date|today['’]?s\s+date|what\s+day\s+is\s+(?:it|today)|какое\s+сегодня\s+число|какой\s+сегодня\s+день|сегодняшн[яю]+\s+дат/u.test(low))
        return ret("date",fmt(today0,T.today));
    }

    /* 8. робота з текстом */
    const want={
      sum:/підсум|резюм|стисло|коротк(?:о|ий)\s+(?:зміст|виклад|переказ)|скороти|перекажи|tl;?dr|summar|суммир|подытож|кратк(?:о|ое|ий)\s+(?:содерж|излож|переск)|перескажи|про\s+що\s+(?:цей|текст|документ|йдеться)|о\s+ч[её]м\s+(?:этот|текст|документ|речь)|what\s+is\s+(?:this|the\s+text|it)\s+about/u.test(low),
      kw:/ключов|keyword|key\s+words|головні\s+слова|основні\s+теми|ключев|главные\s+слова/u.test(low),
      stats:/статистик|скільки\s+(?:слів|речень|символів)|word\s+count|how\s+many\s+(?:words|sentences)|сколько\s+(?:слов|предложений|символов)|читабельн|читаемост|readab/u.test(low),
      dates:/(?:^|[^\p{L}])(?:дати|дату|дат|терміни|дедлайн[и]?|dates?|deadlines?|даты|сроки)(?![\p{L}])/u.test(low)&&!/сьогодні|today|сегодня/u.test(low),
      nums:/(?:^|[^\p{L}])(?:числа|цифри|суми|numbers|amounts|figures|цифры|суммы)(?![\p{L}])/u.test(low),
      acts:/що\s+(?:треба|потрібно)\s+зробити|(?:^|[^\p{L}])(?:завдання|список\s+справ)(?![\p{L}])|action\s+items|to-?do|(?:^|[^\p{L}])tasks(?![\p{L}])|что\s+(?:нужно|надо)\s+сделать|(?:^|[^\p{L}])задачи(?![\p{L}])/u.test(low),
      tone:/(?:^|[^\p{L}])(?:тон|настрій|настроение|sentiment|tone)(?![\p{L}])/u.test(low)
    };
    const anyTool=want.sum||want.kw||want.stats||want.dates||want.nums||want.acts||want.tone;
    /* текст для роботи: файл → частина повідомлення після двокрапки/рядка → саме довге повідомлення → останній текст */
    let body="";
    {
      /* «підсумуй: <текст>» — команда на початку, текст після двокрапки чи з нового рядка.
         Двокрапка всередині звичайного тексту («о 15:00») командою не вважається. */
      const idx=q.search(/:\s|\n/);
      const tailText=idx>=0?q.slice(idx+1).trim():"";
      if(ctxText)body=ctxText;
      else if(anyTool&&tailText.length>=120&&idx<120)body=tailText;
      else if(q.length>=400)body=q;
    }
    const commandOnly=anyTool&&words<=14&&!body;
    if(anyTool&&(body||commandOnly)){
      const text=body||last.text;
      if(!text)return ret("text",T.needText,{handled:false});
      last.text=text;last.hits=[];last.question="";
      const md=textTools(text,want,T,lang);
      if(md)return ret("text",md,{sources:[{type:body===ctxText&&ctxText?"context":"last"}]});
    }
    /* довгий текст без команди — повний звіт */
    if(!anyTool&&body&&body===q&&!/[?]\s*$/.test(q)){
      last.text=body;last.hits=[];last.question="";
      const md=textTools(body,{sum:true,kw:true,stats:true},T,lang);
      return ret("text.report",md+"\n\n"+T.can,{sources:[{type:"last"}]});
    }
    if(body&&body!==q)last.text=body;

    /* 9. уточнення до попередньої відповіді */
    if(words<=4&&/^(?:а\s+)?(?:коротше|стисліше|ще\s+коротше|shorter|short(?:er)?\s+please|короче|покороче)[\s.!?]*$/iu.test(low)){
      const src=last.hits.length?last.hits[0].s:(last.text?summarize(last.text,1)[0]:"");
      if(!src)return ret("refine",T.noRefine,{handled:false});
      return ret("refine",T.shorter+"\n\n- "+src);
    }
    if(words<=4&&/^(?:а\s+)?(?:докладніше|детальніше|більше|ще|розкажи\s+більше|more|more\s+detail(?:s)?|tell\s+me\s+more|подробнее|детальнее|больше|ещё|еще)[\s.!?]*$/iu.test(low)){
      if(last.question){
        const cand=findAnswer(last.question,ctxText,T,lang);
        const src=cand?(cand.type==="doc"?(mem.docs.find(d=>d.title===cand.title)||{}).text:(cand.type==="context"?ctxText:(cand.type==="last"?last.text:""))):"";
        const more=src?__aScored(last.question,src,6):[];
        if(more.length>1)return ret("refine",T.more+"\n\n"+more.map(h=>"- "+h.s).join("\n"));
      }
      if(last.text){const sm=summarize(last.text,6);if(sm.length)return ret("refine",T.more+"\n\n"+sm.map(s=>"- "+s).join("\n"))}
      return ret("refine",T.noRefine,{handled:false});
    }

    /* 10. розмова */
    if(words<=7){
      if(/що\s+ти\s+(?:вмієш|можеш|умієш)|допомо(?:га|жи)\s*$|^допомога|^help\b|what\s+can\s+you\s+do|что\s+ты\s+(?:умеешь|можешь)|^команди|^commands|^помощь/u.test(low))return ret("help",T.help);
      if(/хто\s+ти|що\s+ти\s+таке|ти\s+(?:ші|ai|бот|людина|робот)|who\s+are\s+you|what\s+are\s+you|are\s+you\s+(?:an?\s+)?(?:ai|bot|human)|кто\s+ты|что\s+ты\s+такое|ты\s+(?:ии|ai|бот|человек|робот)/u.test(low))return ret("identity",T.who);
      if(/як\s+(?:справи|ти|життя|воно)|how\s+are\s+you|how['’]s\s+it\s+going|как\s+(?:дела|ты|жизнь)/u.test(low))return ret("smalltalk",T.how);
      if(/дякую|спасибі|дяка|thanks|thank\s+you|thx|спасибо|благодарю/u.test(low))return ret("smalltalk",__aPick(T.thanks,raw));
      if(/^(?:бувай|до\s+побачення|па-?па|на\s+все\s+добре|bye|goodbye|see\s+you|пока|до\s+свидания)/u.test(low))return ret("smalltalk",T.bye);
      if(greeted&&q===raw)return ret("greeting",mem.prefs.name?__aFill(T.helloName,{name:mem.prefs.name}):__aPick(T.hello,raw));
      if(/як\s+мене\s+звати|моє\s+ім['’ʼ]?я\s*\?|what(?:['’]s|\s+is)\s+my\s+name|как\s+меня\s+зовут/u.test(low)&&mem.prefs.name)return ret("name",__aFill(T.memName,{name:mem.prefs.name}));
    }

    /* 11. питання → пошук відповіді */
    const cand=findAnswer(q,ctxText,T,lang);
    if(cand&&cand.conf>=0.3){
      const best=cand.hits[0];
      const keep=cand.hits.filter(h=>h.score>=best.score*0.6).slice(0,3);
      last.hits=keep;last.question=q;
      const sure=cand.conf>=0.5;
      const head=sure?"**"+T.ans+"** ("+srcLabel(cand,T)+"):":T.unsure+" ("+srcLabel(cand,T)+")";
      return ret("answer",head+"\n\n"+keep.map(h=>"- "+h.s).join("\n"),{confidence:+cand.conf.toFixed(2),escalate:!sure,sources:[{type:cand.type,title:cand.title||undefined}]});
    }
    /* 12. чесна відмова + сигнал передати хмарному AI */
    last.question=q;last.hits=[];
    return ret("unknown",T.cant+"\n\n"+T.cantHint,{confidence:0,handled:false,escalate:true});
  }

  const safe=(fn,fallback)=>function(){
    try{return fn.apply(null,arguments)}
    catch(e){
      if(e&&e.isCoreError)throw e;
      try{if(typeof console!=="undefined"&&console.error)console.error("[BridgeCore] assistant failed:",e&&e.message||e)}catch(_){}
      return typeof fallback==="function"?fallback():fallback;
    }
  };
  return{
    respond:safe(respond,()=>({text:(__A_T[o.lang]||__A_T.uk).cant,intent:"error",confidence:0,handled:false,escalate:true,sources:[],lang:o.lang||"uk",error:true})),
    learn:safe(learn,null),remember:safe(remember,null),forget:safe(forget,{all:false,n:0,removed:[]}),
    setNotes:safe(setNotes,undefined),exportMemory:safe(exportMemory,"{}"),importMemory:safe(importMemory,false),memoryInfo:safe(memoryInfo,{facts:0,docs:0,docChars:0,name:null,notes:0})
  };
}

const __rawExports={VERSION,createAssistant,detectLang,stats,keywords,keyphrases,summarize,answer,analyze,analyzeChunkRanges,tokenizeQA,composeBudgetedSummary,splitSentences,tokenize,escapeHtml,guardInput,verifyIntegrity,MAX_INPUT_CHARS,TIME_BUDGET_MS,...(__imp1.functions||{}),...(__imp2.functions||{}),...(__imp3.functions||{}),...(__imp4.functions||{}),...(__imp5.functions||{}),...(__imp6.functions||{}),...(__imp7.functions||{}),...(__imp8.functions||{}),...(__imp9.functions||{}),...(__imp10.functions||{}),...(__imp11.functions||{}),...(__imp12.functions||{}),...(__imp13.functions||{}),...(__imp14.functions||{}),...(__imp15.functions||{}),...(__imp16.functions||{}),...(__imp17.functions||{}),...(__imp18.functions||{}),...(__imp19.functions||{}),...(__imp20.functions||{}),...(__imp21.functions||{}),...(__imp22.functions||{}),...(__imp23.functions||{}),...(__imp24.functions||{}),...(__imp25.functions||{}),...(__imp26.functions||{}),...(__imp27.functions||{}),...(__imp28.functions||{}),...(__imp29.functions||{}),...(__imp30.functions||{}),...(__imp31.functions||{}),...(__imp32.functions||{}),...(__imp33.functions||{}),...(__imp34.functions||{}),...(__imp35.functions||{}),...(__imp36.functions||{}),...(__imp37.functions||{}),...(__imp38.functions||{}),...(__imp39.functions||{}),};
const __safeExports={};
for(const __k of Object.keys(__rawExports)){
  const __v=__rawExports[__k];
  __safeExports[__k]=(typeof __v==="function"&&__k!=="verifyIntegrity")?__safeWrap(__k,__v):__v;
}
__publicRef=__safeExports;
/* Базова лінія цілісності — знімок саме того, що віддаємо назовні. */
__integrityBaseline=__integrityHash(__safeExports);
return __safeExports;
})();

/* Node (тести) + браузер. */
if(typeof module!=="undefined"&&module.exports)module.exports=BridgeCore;
if(typeof window!=="undefined")window.BridgeCore=BridgeCore;
