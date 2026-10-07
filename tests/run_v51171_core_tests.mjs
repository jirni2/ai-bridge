/* Інтеграційні тести BridgeCore v5.11.72 — усі функції 39 модулів + база.
   Написано координатором (агент 40 завис без результату).
   Запуск: node integration_tests.mjs (після інтеграції core.js). */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const __PKG_VERSION = require('../bridge-version.json').version /* v5.11.92: було жорстко прописано шлях на машині автора */;
const C = require('../core.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS: ' + name); }
  else { fail++; console.log('FAIL: ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 160) : '')); }
}
function has(fn) { return typeof C[fn] === 'function'; }
function hasV(v) { return C[v] !== undefined; }

const UK = "Мрії витягують тебе з ями, коли ти впав. Не чекай ідеального моменту. Шторм не вічний.";
const EN = "Dreams pull you out of the pit when you fall. Do not wait for the perfect moment. The storm is not eternal.";

/* База v5.11.70 */
ok('VERSION='+__PKG_VERSION, C.VERSION === __PKG_VERSION, C.VERSION);
ok('detectLang uk', C.detectLang(UK) === 'uk');
ok('detectLang en', C.detectLang(EN) === 'en');
ok('stats', C.stats(UK).words > 5);
ok('keywords', Array.isArray(C.keywords(UK, 3)) && C.keywords(UK, 3).length > 0);
ok('summarize', C.summarize(UK, 2).length === 2);
ok('answer', C.answer("що витягує з ями?", UK, 1).length >= 1);
ok('analyze', C.analyze(UK).lang === 'uk');
ok('splitSentences', C.splitSentences(UK).length === 3);
ok('tokenize', C.tokenize(UK).length > 0);

/* 1 */ ok('splitSentencesSmart', has('splitSentencesSmart') && C.splitSentencesSmart("Зустрінь Mr. Smith, напр. о 10:30. Він прийде.").length === 2);
/* 2 */ ok('STOP_UK_EXTENDED', hasV('STOP_UK_EXTENDED') && C.STOP_UK_EXTENDED.size >= 200 && C.isStopUK('дуже') && !C.isStopUK('перемога'));
/* 3 */ ok('STOP_EN/RU', hasV('STOP_EN_EXTENDED') && hasV('STOP_RU_EXTENDED') && C.STOP_EN_EXTENDED.size >= 150 && C.STOP_RU_EXTENDED.size >= 150 && C.isStopEN('however') && C.isStopRU('является'));
/* 4 */ ok('stemUK', has('stemUK') && C.stemUK('витягують') === 'витяг');
/* 5 */ ok('normalizeText', has('normalizeText') && C.normalizeText("# Заголовок\n**жирний**").includes('Заголовок') && !C.normalizeText("# Заголовок").includes('#'));
/* 6 */ ok('summarizeTFIDF', has('summarizeTFIDF') && C.summarizeTFIDF(UK, 1).length === 1);
/* 7 */ ok('scoreSentencePosition/summarizeLeadBias', has('scoreSentencePosition') && C.scoreSentencePosition(0, 10) === 2.0 && C.summarizeLeadBias(UK, 2).length === 2);
/* 8 */ ok('sentenceSimilarity/dedupeSentences', has('sentenceSimilarity') && C.sentenceSimilarity("Кіт спить.", "Кіт спить.") === 1 && C.dedupeSentences(["Кіт спить.", "Кіт спить.", "Собака біжить."]).length === 2);
/* 9 */ ok('splitByHeadings/summarizeStructured', has('splitByHeadings') && C.splitByHeadings("# Вступ\nТекст.").length === 1 && C.summarizeStructured("# А\nКіт спить. Собака біжить.", 1)[0].summary.length === 1);
/* 10 */ ok('summarizeMulti', has('summarizeMulti') && C.summarizeMulti([UK, EN], 2).length === 2);
/* 11 */ ok('detectQuestionType', has('detectQuestionType') && C.detectQuestionType("Хто прийшов?") === 'who' && C.detectQuestionType("Чи працює?") === 'yesno');
/* 12 */ ok('extractEntities', has('extractEntities') && C.extractEntities("Іван Петренко з ТОВ Веселка був у Києві.").persons.includes('Іван Петренко'));
/* 13 */ ok('extractDatesNumbers', has('extractDatesNumbers') && C.extractDatesNumbers("Зустріч 4 жовтня 2026, 100 км.").dates.length === 1 && C.extractDatesNumbers("100 км").numbers[0].value === 100);
/* 14 */ ok('extractQuotes', has('extractQuotes') && C.extractQuotes('Він сказав: «Привіт».')[0].quote === 'Привіт');
/* 15 */ ok('extractActionItems', has('extractActionItems') && C.extractActionItems("TODO: купити хліб.").length >= 1);
/* 16 */ ok('sentiment', has('sentiment') && C.sentiment("Чудовий день!").label === 'positive' && C.sentiment("Жахлива втрата.").label === 'negative');
/* 17 */ ok('readability', has('readability') && typeof C.readability(UK + " " + UK + " " + UK).score === 'number');
/* 18 */ ok('vocabularyRichness', has('vocabularyRichness') && C.vocabularyRichness(UK).ttr > 0 && C.vocabularyRichness(UK).ttr <= 1);
/* 19 */ ok('detectTopics', has('detectTopics') && C.detectTopics("Футбол класний. Матч був довгим. Суп смачний. Обід вдався.", 2).length === 2);
/* 20 */ ok('classifyText', has('classifyText') && C.classifyText("Повідомляється, що міністр заявив.").type === 'news');
/* 21 */ ok('keyPhrases', has('keyPhrases') && C.keyPhrases("Штучний інтелект змінює світ. Штучний інтелект росте.", 5)[0].phrase === 'штучний інтелект');
/* 22 */ ok('collocations', has('collocations') && C.collocations("Штучний інтелект росте. Штучний інтелект змінює. Штучний інтелект перемагає.", 3)[0].phrase === 'штучний інтелект');
/* 23 */ ok('keywordsTFIDF', has('keywordsTFIDF') && C.keywordsTFIDF(UK, 5).length > 0 && typeof C.keywordsTFIDF(UK, 5)[0].tfidf === 'number');
/* 24 */ ok('detectHeadings', has('detectHeadings') && C.detectHeadings("# Вступ\nТекст")[0].level === 1);
/* 25 */ ok('detectLists', has('detectLists') && C.detectLists("- а\n- б")[0].type === 'unordered');
/* 26 */ ok('detectParagraphs', has('detectParagraphs') && C.detectParagraphs("Один.\n\nДва.").count === 2);
/* 27 */ ok('extractTables', has('extractTables') && C.extractTables("| А | Б |\n|---|---|\n| 1 | 2 |")[0].headers.length === 2);
/* 28 */ ok('generateQuestions', has('generateQuestions') && C.generateQuestions("Тарас Шевченко народився 9 березня 1814 року.", 3).length > 0);
/* 29 */ ok('findParaphrases', has('findParaphrases') && Array.isArray(C.findParaphrases(UK, 0.6)));
/* 30 */ ok('tokenizeFast/analyzeLarge', has('tokenizeFast') && C.tokenizeFast(UK).length > 0 && C.analyzeLarge(UK, 100).totalWords > 0);
/* 31 */ ok('createCache/memoize', has('createCache') && has('memoize') && (() => { const m = C.memoize(x => x * 2); return m(3) === 6 && m(3) === 6; })());
/* 32 */ ok('chunkText/streamProcess', has('chunkText') && C.chunkText("раз два три", 8).join('|') === 'раз два|три' && C.streamProcess("а б", 10, c => c).length >= 1);
/* 33 */ ok('exportMarkdown', has('exportMarkdown') && C.exportMarkdown(C.analyze(UK)).includes('# Аналіз тексту'));
/* 34 */ ok('exportJSON/parseAnalysis', has('exportJSON') && C.parseAnalysis(C.exportJSON({ a: 1 })).analysis.a === 1 && C.parseAnalysis('xx') === null);
/* 35 */ ok('coherence', has('coherence') && typeof C.coherence(UK).score === 'number');
/* 36 */ ok('detectLangMixed', has('detectLangMixed') && C.detectLangMixed(UK).primary === 'uk');
/* 37 */ ok('statsExtended', has('statsExtended') && C.statsExtended(UK).longestSentence.length > 0 && C.statsExtended(UK).medianSentenceLen > 0);
/* 38 */ ok('textSimilarity', has('textSimilarity') && C.textSimilarity(UK, UK).score === 1);
/* 39 */ ok('fingerprint', has('fingerprint') && C.fingerprint(UK) === C.fingerprint(UK.toUpperCase()) && C.fingerprint(UK) !== C.fingerprint(EN));

console.log('\nУСЬОГО: ' + pass + '/' + (pass + fail) + ' PASS');
process.exit(fail ? 1 : 0);
