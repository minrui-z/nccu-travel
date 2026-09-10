import type { RichTextRun, MergeRange } from './xls-exporter';
export interface TemplateFont { name:string;size:number;bold:boolean;italic:boolean;underline:number;color:string|null }
export interface TemplateStyle { fontIndex:number;numberFormat:string;horizontal:number;vertical:number;wrap:boolean;rotation:number;shrinkToFit:boolean;indent:number;fill:string|null;borders:Record<'left'|'right'|'top'|'bottom',{style:number;color:string|null}> }
export interface TemplateCell { address:string;row:number;col:number;value:string|number;type:number;styleIndex:number;runs:RichTextRun[] }
export interface TemplateSheet { name:string;printArea:string;paper?:'A4';orientation?:'portrait';fitWidth?:1;fitHeight?:1;rowHeights:number[];columnWidths:number[];merges:MergeRange[];cells:TemplateCell[];drawing:{text:string;range:string}|null }
export interface TemplateManifest {
 id:string;kind:'general'|'student';segmentCount:number;file:string;sheetName:string;sha256:string;
 fields:Record<string,string|string[]|null>;
 segments:Array<{startCol:number;endCol:number;fields:Record<string,string>}>;
 fonts:TemplateFont[];styles:TemplateStyle[];sheets:TemplateSheet[];formatVersion?:1;sourceVersion?:string;limits:{maxTextLength:number;maxSegments:number};
}
/** Verify fetched static assets against the matching versioned manifest before export. */
export async function verifyTemplateDigest(bytes:Uint8Array,expected:string):Promise<void>{
 const digest=await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes).buffer);
 const actual=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
 if(actual!==expected.toLowerCase())throw new Error('表單模板與版本資料不一致，請重新載入網頁。');
}
