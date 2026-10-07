import fs from 'node:fs';
import assert from 'node:assert/strict';

const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');

assert.ok(
  /const context=source==="files"\?buildFileContext\((?:\{task:prompt\})?\):"";/.test(app),
  'Chat/Team must not inherit Files attachments; fileContext must be built only for source="files"'
);
assert.ok(
  app.includes('const payload={prompt,displayPrompt:prompt,fileContext:context'),
  'The isolated context must still be sent through the dedicated fileContext field'
);
assert.ok(
  app.includes('$('+'"sendBtn"'+').onclick=()=>sendTask({source:"chat"})'),
  'Main Chat send must identify itself as source="chat"'
);
assert.ok(
  app.includes('$('+'"fileSendBtn"'+').onclick=()=>sendTask({source:"files"})'),
  'Files send must identify itself as source="files"'
);

console.log('v5.1.3 context isolation tests passed');
