export class ProtocolError extends Error { constructor(code) { super(code); this.code = code; } }
const fail = code => { throw new ProtocolError(code); };
export function strictJson(text) {
  if (typeof text !== 'string' || text.length > 2 * 1024 * 1024) fail('invalid_json');
  let parsed; try { parsed = JSON.parse(text); } catch { fail('invalid_json'); }
  // JSON.parse alone discards duplicate keys. Walk the validated grammar and
  // compare decoded keys, including escaped aliases, without repairing output.
  let index = 0, depth = 0;
  const whitespace = () => {while (/\s/.test(text[index] || '') && index < text.length) index++;};
  function string() {const start=index++;while(index<text.length){const ch=text[index++];if(ch==='"')return JSON.parse(text.slice(start,index));if(ch==='\\')index++;}fail('invalid_json');}
  function value() {
    if (++depth > 80) fail('json_too_deep'); whitespace();
    if (text[index] === '{') {index++; whitespace(); const keys=new Set();while(text[index]!=='}'){const key=string();if(keys.has(key))fail('duplicate_json_key');keys.add(key);whitespace();index++;value();whitespace();if(text[index]!==',')break;index++;whitespace();}index++;}
    else if(text[index]==='['){index++;whitespace();while(text[index]!==']'){value();whitespace();if(text[index]!==',')break;index++;}index++;}
    else if(text[index]==='"') string();
    else {while(index<text.length && !/[\s,}\]]/.test(text[index]))index++;}
    depth--;
  }
  value(); return parsed;
}
