import * as CFB from 'cfb';

/** Offsets are UTF-16 code units, and fontIndex is the original BIFF FONT index. */
export interface RichTextRun { start: number; fontIndex: number }
export interface RichTextValue { text: string; runs?: RichTextRun[] }
export type XlsValue = string | number | null | RichTextValue;
export type XlsChanges = Record<string, Record<string, XlsValue>>;
/** Append-only formatting for editable text. Existing FONT/XF records remain byte-identical. */
export interface XlsTextFormatting {
  fontCount: number;
  styleCount: number;
  fonts: Array<{ sourceIndex: number; index: number; size: number }>;
  styles: Array<{ sourceIndex: number; index: number; fontIndex: number; wrap: boolean }>;
  cells: Record<string, Record<string, number>>;
}
export interface MergeRange { r1: number; r2: number; c1: number; c2: number }
/** Build-time only: keeps the outer sheet geometry and all non-date records intact. */
export interface TemplateLayoutChanges {
  sheet: string;
  replaceDateMerges?: MergeRange[];
  styles?: Record<string, number>;
}
export interface BiffRecord { id: number; data: Uint8Array; oldOffset: number; offset: number; sheet: string }

const ID = { BOF: 0x809, EOF: 0x0a, BOUNDSHEET: 0x85, SST: 0xfc, CONTINUE: 0x3c,
  EXTSST: 0xff, INDEX: 0x20b, DBCELL: 0xd7, ROW: 0x208, LABELSST: 0xfd,
  BLANK: 0x201, MULBLANK: 0xbe, NUMBER: 0x203, RK: 0x27e, BOOLERR: 0x205, MERGE: 0xe5 };
const utf16 = new TextDecoder('utf-16le');
const u16 = (b: Uint8Array, o = 0) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint16(o, true);
const u32 = (b: Uint8Array, o = 0) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(o, true);
const put16 = (b: Uint8Array, o: number, n: number) => new DataView(b.buffer, b.byteOffset, b.byteLength).setUint16(o, n, true);
const put32 = (b: Uint8Array, o: number, n: number) => new DataView(b.buffer, b.byteOffset, b.byteLength).setUint32(o, n, true);
const join = (parts: Uint8Array[]) => { const b = new Uint8Array(parts.reduce((s, x) => s + x.length, 0)); let p = 0; for (const x of parts) { b.set(x, p); p += x.length; } return b; };
function fail(message: string): never { throw new Error(`XLS 匯出：${message}`); }
export function cellAddress(row: number, col: number): string {
  let s = ''; for (let c = col + 1; c; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + (c - 1) % 26) + s;
  return s + (row + 1);
}
export function parseCellAddress(address: string): { row: number; col: number } {
  const m = /^([A-Z]+)([1-9][0-9]*)$/.exec(address);
  if (!m) fail(`無效儲存格 ${address}`);
  let col = 0; for (const ch of m[1]) col = col * 26 + ch.charCodeAt(0) - 64;
  return { row: Number(m[2]) - 1, col: col - 1 };
}
function record(id: number, data: Uint8Array, source?: BiffRecord): BiffRecord {
  return { id, data, oldOffset: source?.oldOffset ?? -1, offset: -1, sheet: source?.sheet ?? '' };
}
export function parseBiff(stream: Uint8Array): BiffRecord[] {
  const records: BiffRecord[] = [];
  for (let p = 0; p < stream.length;) {
    if (p + 4 > stream.length) fail('模板記錄標頭不完整');
    const id = u16(stream, p), len = u16(stream, p + 2);
    if (p + 4 + len > stream.length || len > 8224) fail('模板記錄長度不正確');
    records.push({ id, data: stream.slice(p + 4, p + 4 + len), oldOffset: p, offset: p, sheet: '' }); p += 4 + len;
  }
  const sheets = new Map<number, string>();
  for (const r of records) if (r.id === ID.BOUNDSHEET) {
    const len = r.data[6], wide = r.data[7] & 1;
    const name = wide ? utf16.decode(r.data.subarray(8, 8 + len * 2)) : String.fromCharCode(...r.data.subarray(8, 8 + len));
    sheets.set(u32(r.data), name);
  }
  let sheet = '';
  for (const r of records) { if (r.id === ID.BOF) sheet = sheets.get(r.oldOffset) ?? ''; r.sheet = sheet; }
  return records;
}
export function workbookStream(bytes: Uint8Array): Uint8Array {
  const entry = CFB.find(CFB.read(bytes, { type: 'array' }), 'Workbook');
  if (!entry) fail('找不到原始 BIFF8 Workbook 串流');
  return Uint8Array.from(entry.content);
}
interface SstEntry { raw: Uint8Array; record: BiffRecord; dataOffset: number; text: string; runs: RichTextRun[] }
function originalSst(records: BiffRecord[]): { rec: BiffRecord; entries: SstEntry[] } {
  const i = records.findIndex(r => r.id === ID.SST);
  if (i < 0) fail('模板缺少共用字串表');
  const rec = records[i], data = rec.data;
  // The two pinned January 2026 templates have one uncontinued SST. Reject a
  // different template instead of guessing at rich-text continuation semantics.
  if (records[i + 1]?.id === ID.CONTINUE) fail('此版本只支援隨附的原始空白模板');
  const entries: SstEntry[] = []; let p = 8;
  for (let j = 0; j < u32(data, 4); j++) {
    const start = p, n = u16(data, p), flags = data[p + 2]; p += 3;
    const runCount = flags & 8 ? u16(data, p) : 0; if (flags & 8) p += 2;
    const extLength = flags & 4 ? u32(data, p) : 0; if (flags & 4) p += 4;
    const wide = flags & 1, textLength = n * (wide ? 2 : 1);
    if (p + textLength + runCount * 4 + extLength > data.length) fail('原始字串表界線不完整');
    const text = wide ? utf16.decode(data.subarray(p, p + textLength)) : String.fromCharCode(...data.subarray(p, p + textLength));
    p += textLength;
    const runs: RichTextRun[] = [];
    for (let k = 0; k < runCount; k++, p += 4) runs.push({ start: u16(data, p), fontIndex: u16(data, p + 2) });
    p += extLength;
    entries.push({ raw: data.slice(start, p), record: rec, dataOffset: start, text, runs });
  }
  if (p !== data.length) fail('模板共用字串表含未辨識的尾端資料');
  return { rec, entries };
}
function encodeText(value: string | RichTextValue, maxFontIndex: number): { raw: Uint8Array; text: string; runs: RichTextRun[] } {
  const text = typeof value === 'string' ? value : value.text;
  const runs = typeof value === 'string' ? [] : value.runs ?? [];
  if (typeof text !== 'string' || text.length > 2048) fail('每一欄文字最多 2048 個字元');
  // Ill-formed surrogate sequences or embedded NUL/control characters cannot
  // be represented reliably across Excel versions. Newlines and tabs are valid.
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) fail('文字包含不支援的控制字元');
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) { const n = text.charCodeAt(++i); if (!(n >= 0xdc00 && n <= 0xdfff)) fail('文字包含不完整的 Unicode 字元'); }
    else if (c >= 0xdc00 && c <= 0xdfff) fail('文字包含不完整的 Unicode 字元');
  }
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    if (!Number.isInteger(r.start) || r.start < 0 || r.start > text.length || (i > 0 && r.start <= runs[i - 1].start)) fail('富文字分段順序不正確');
    if (!Number.isInteger(r.fontIndex) || r.fontIndex < 0 || r.fontIndex === 4 || r.fontIndex > maxFontIndex) fail('富文字使用不存在的原模板字型');
  }
  const raw = new Uint8Array(3 + (runs.length ? 2 : 0) + text.length * 2 + runs.length * 4);
  if (raw.length > 8224) fail('富文字分段超過單欄容量');
  put16(raw, 0, text.length); raw[2] = 1 | (runs.length ? 8 : 0); let p = 3;
  if (runs.length) { put16(raw, p, runs.length); p += 2; }
  for (let i = 0; i < text.length; i++, p += 2) put16(raw, p, text.charCodeAt(i));
  for (const r of runs) { put16(raw, p, r.start); put16(raw, p + 2, r.fontIndex); p += 4; }
  return { raw, text, runs };
}
function cellRecord(row: number, col: number, xf: number, value: XlsValue, stringIndex: (v: string | RichTextValue) => number): BiffRecord {
  const numeric = typeof value === 'number', empty = value === null;
  if (numeric && !Number.isFinite(value)) fail('金額必須是有限數字');
  const data = new Uint8Array(empty ? 6 : numeric ? 14 : 10);
  put16(data, 0, row); put16(data, 2, col); put16(data, 4, xf);
  if (numeric) new DataView(data.buffer).setFloat64(6, value, true);
  else if (!empty) put32(data, 6, stringIndex(value));
  return record(empty ? ID.BLANK : numeric ? ID.NUMBER : ID.LABELSST, data);
}
function readMerges(rec: BiffRecord): MergeRange[] {
  const out: MergeRange[] = [];
  for (let p = 2; p < rec.data.length; p += 8) out.push({ r1: u16(rec.data,p), r2: u16(rec.data,p+2), c1: u16(rec.data,p+4), c2: u16(rec.data,p+6) });
  return out;
}
function encodeMerges(merges: MergeRange[]): Uint8Array {
  if (merges.length > 1026) fail('合併範圍過多');
  const d = new Uint8Array(2 + merges.length * 8); put16(d,0,merges.length);
  for (let i=0;i<merges.length;i++) { const m=merges[i],p=2+i*8; put16(d,p,m.r1);put16(d,p+2,m.r2);put16(d,p+4,m.c1);put16(d,p+6,m.c2); }
  return d;
}
function patchCore(bytes: Uint8Array, changes: XlsChanges, layout?: TemplateLayoutChanges, formatting?: XlsTextFormatting): Uint8Array {
  const cfb = CFB.read(bytes, { type: 'array' });
  const entry = CFB.find(cfb, 'Workbook'); if (!entry) fail('檔案不是支援的原始 XLS 模板');
  const original = parseBiff(Uint8Array.from(entry.content));
  const oldByOffset = new Map(original.map(r => [r.oldOffset, r]));
  const { rec: sstRec, entries } = originalSst(original);
  const fontRecords=original.filter(r=>r.id===0x31), xfRecords=original.filter(r=>r.id===0xe0);
  // BIFF skips FONT index 4; manifests include that reserved entry.
  const originalFontCount=fontRecords.length+1;
  const addedFonts:BiffRecord[]=[],addedStyles:BiffRecord[]=[];
  if(formatting){
    if(formatting.fontCount!==originalFontCount||formatting.styleCount!==xfRecords.length)fail('文字格式與模板版本不一致');
    for(const f of formatting.fonts){
      const source=fontRecords[f.sourceIndex>4?f.sourceIndex-1:f.sourceIndex];
      if(!source||f.sourceIndex===4||f.index!==originalFontCount+addedFonts.length||!Number.isFinite(f.size)||f.size<8||f.size>u16(source.data)/20)fail('自動文字字級不正確');
      const data=source.data.slice();put16(data,0,Math.round(f.size*20));addedFonts.push(record(0x31,data));
    }
    for(const s of formatting.styles){
      const source=xfRecords[s.sourceIndex];
      if(!source||s.index!==xfRecords.length+addedStyles.length||s.index>=4000||s.fontIndex===4||!Number.isInteger(s.fontIndex)||s.fontIndex<0||s.fontIndex>=originalFontCount+addedFonts.length)fail('自動文字樣式不正確');
      const data=source.data.slice();
      // MS-XLS CellXF: font index, fWrap, fShrinkToFit and font/alignment inheritance flags.
      put16(data,0,s.fontIndex);data[6]=(data[6]&~8)|(s.wrap?8:0);data[8]&=~16;data[9]|=0x18;
      addedStyles.push(record(0xe0,data));
    }
    for(const [sheet,cells] of Object.entries(formatting.cells))for(const [address,index] of Object.entries(cells)){
      if(!Object.hasOwn(changes[sheet]??{},address)||!Number.isInteger(index)||index<xfRecords.length||index>=xfRecords.length+addedStyles.length)fail('自動文字格式只能套用於本次填寫欄位');
    }
  }
  const maxFontIndex = fontRecords.length+addedFonts.length;
  const added: SstEntry[] = [], stringMap = new Map<string,number>();
  entries.forEach((e,i)=>{if(!(e.raw[2]&4))stringMap.set(JSON.stringify([e.text,e.runs]),i);});
  const getStringIndex = (v: string | RichTextValue) => {
    const encoded=encodeText(v,maxFontIndex), key=JSON.stringify([encoded.text,encoded.runs]);
    const existing=stringMap.get(key); if(existing!==undefined)return existing;
    const index=entries.length+added.length;
    stringMap.set(key,index); added.push({...encoded,record:record(ID.CONTINUE,new Uint8Array()),dataOffset:0}); return index;
  };
  const sheetNames=new Set(original.filter(r=>r.sheet).map(r=>r.sheet));
  const remaining=new Set<string>();
  for(const [sheet, cells] of Object.entries(changes)) {
    if(!sheetNames.has(sheet))fail(`找不到工作表 ${sheet}`);
    for(const address of Object.keys(cells)){parseCellAddress(address);remaining.add(`${sheet}!${address}`);}
  }
  const output: BiffRecord[]=[];
  const counts=new Map<string,number>();
  const has=(o:object|undefined,k:string)=>!!o&&Object.prototype.hasOwnProperty.call(o,k);
  for(const source of original) {
    const edits=changes[source.sheet];
    const styles=formatting?.cells[source.sheet]??(layout?.sheet===source.sheet?layout.styles:undefined);
    const d=source.data;
    if(source.id===ID.MULBLANK) {
      const row=u16(d),first=u16(d,2),last=u16(d,d.length-2);
      let touched=false;for(let col=first;col<=last;col++){const a=cellAddress(row,col);if(has(edits,a)||has(styles,a))touched=true;}
      if(touched){
        for(let col=first;col<=last;col++){
          const a=cellAddress(row,col),xf=has(styles,a)?styles![a]:u16(d,4+(col-first)*2);
          const r=cellRecord(row,col,xf,has(edits,a)?edits[a]:null,getStringIndex);
          r.sheet=source.sheet;r.oldOffset=col===first?source.oldOffset:-1;output.push(r);remaining.delete(`${source.sheet}!${a}`);
        }continue;
      }
    } else if([ID.LABELSST,ID.BLANK,ID.NUMBER,ID.RK,ID.BOOLERR].includes(source.id)) {
      const row=u16(d),col=u16(d,2),a=cellAddress(row,col);
      if(has(edits,a)) {
        const r=cellRecord(row,col,has(styles,a)?styles![a]:u16(d,4),edits[a],getStringIndex);
        r.sheet=source.sheet;r.oldOffset=source.oldOffset;output.push(r);remaining.delete(`${source.sheet}!${a}`);continue;
      }
      if(has(styles,a)){const copy=d.slice();put16(copy,4,styles![a]);output.push(record(source.id,copy,source));continue;}
    }
    if(source.id===ID.MERGE&&layout?.sheet===source.sheet&&layout.replaceDateMerges){
      const keep=readMerges(source).filter(m=>!(m.r1>=10&&m.r2<=23&&m.c1>=2&&m.c2<=13));
      output.push(record(source.id,encodeMerges([...keep,...layout.replaceDateMerges]),source));continue;
    }
    output.push(record(source.id,d.slice(),source));
  }
  if(remaining.size)fail(`欄位不在模板已配置的儲存格內：${[...remaining].join('、')}`);
  // Append within each global record collection, preserving every original index and byte.
  if(addedFonts.length){const last=output.findLastIndex(r=>r.id===0x31);output.splice(last+1,0,...addedFonts);}
  if(addedStyles.length){const last=output.findLastIndex(r=>r.id===0xe0);output.splice(last+1,0,...addedStyles);}
  for(const r of output) if(r.id===ID.LABELSST)counts.set('strings',(counts.get('strings')??0)+1);
  const sstOut=output.find(r=>r.oldOffset===sstRec.oldOffset)!;
  put32(sstOut.data,0,counts.get('strings')??0);put32(sstOut.data,4,entries.length+added.length);
  for(const e of entries)e.record=sstOut;
  const extraRecords:BiffRecord[]=[];let chunk:Uint8Array[]=[];let length=0;let grouped:SstEntry[]=[];
  const flush=()=>{if(!chunk.length)return;const r=record(ID.CONTINUE,join(chunk));for(const e of grouped)e.record=r;extraRecords.push(r);chunk=[];grouped=[];length=0;};
  for(const e of added){if(length+e.raw.length>8224)flush();e.dataOffset=length;chunk.push(e.raw);length+=e.raw.length;grouped.push(e);}flush();
  output.splice(output.indexOf(sstOut)+1,0,...extraRecords);
  const allStrings=[...entries,...added],extOut=output.find(r=>r.id===ID.EXTSST);
  if(!extOut)fail('模板缺少 ExtSST 字串索引');
  const bucketSize=Math.max(8,Math.ceil(allStrings.length/128));
  extOut.data=new Uint8Array(2+8*Math.ceil(allStrings.length/bucketSize));put16(extOut.data,0,bucketSize);
  const offsets=new Map<number,number>();let cursor=0;
  for(const r of output){r.offset=cursor;if(r.oldOffset>=0)offsets.set(r.oldOffset,cursor);cursor+=4+r.data.length;}
  const remap=(old:number)=>{const value=offsets.get(old);if(value===undefined)fail(`無法重定位模板索引 ${old}`);return value;};
  for(const r of output){
    if(r.id===ID.BOUNDSHEET)put32(r.data,0,remap(u32(r.data)));
    if(r.id===ID.INDEX){for(let p=12;p<r.data.length;p+=4){const old=u32(r.data,p);if(old)put32(r.data,p,remap(old));}}
    if(r.id===ID.DBCELL){
      const distance=u32(r.data),firstRowOld=r.oldOffset-distance;
      if(!distance)continue;
      const firstRow=oldByOffset.get(firstRowOld);if(!firstRow||firstRow.id!==ID.ROW)fail('DBCell 起始列索引不正確');
      put32(r.data,0,r.offset-remap(firstRowOld));
      let oldPointer=firstRowOld+4+firstRow.data.length,newPointer=remap(firstRowOld)+4+firstRow.data.length;
      for(let p=4;p<r.data.length;p+=2){oldPointer+=u16(r.data,p);const target=remap(oldPointer),delta=target-newPointer;if(delta<0||delta>65535)fail('單列資料超過 BIFF 索引容量');put16(r.data,p,delta);newPointer=target;}
    }
  }
  for(let i=0;i<allStrings.length;i+=bucketSize){const e=allStrings[i],p=2+(i/bucketSize)*8;put32(extOut.data,p,e.record.offset+4+e.dataOffset);put16(extOut.data,p+4,4+e.dataOffset);}
  const stream=new Uint8Array(cursor);
  for(const r of output){put16(stream,r.offset,r.id);put16(stream,r.offset+2,r.data.length);stream.set(r.data,r.offset+4);}
  entry.content=stream;entry.size=stream.length;
  return Uint8Array.from(CFB.write(cfb,{type:'array',fileType:'cfb'}));
}

/** Browser-safe, deterministic XLS patch. No network, filesystem, or worksheet reserialization. */
export function patchXls(template: Uint8Array, changes: XlsChanges, formatting?: XlsTextFormatting): Uint8Array {
  if(Object.values(changes).every(c=>Object.keys(c).length===0))return template.slice();
  return patchCore(template,changes,undefined,formatting);
}
/** Only the build script should use this. Every generated variant is validated before shipping. */
export function buildTemplateVariant(template:Uint8Array,layout:TemplateLayoutChanges):Uint8Array{return patchCore(template,{},layout);}

/** Read original rich text when a caller needs to preserve mixed formatting in a replacement. */
export function readOriginalText(template:Uint8Array,sheet:string,address:string):RichTextValue|undefined{
  const records=parseBiff(workbookStream(template)),{entries}=originalSst(records);
  const cell=records.find(r=>r.sheet===sheet&&r.id===ID.LABELSST&&cellAddress(u16(r.data),u16(r.data,2))===address);
  if(!cell)return undefined;const value=entries[u32(cell.data,6)];return {text:value.text,runs:value.runs};
}
