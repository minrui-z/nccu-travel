"""Independent native XLS reopen (xlrd) and optional rendered PDF checks.
Usage: bundled-python qa/verify-text-fitting.py /path/to/fixture-directory
Generate fixtures with qa/verify-text-fitting.ts first. Render general-full-fit.xls
and student-full-fit.xls to PDFs with the bundled override soffice and original
fonts, each with a unique temporary profile. No Office GUI is used.
"""
import json
from pathlib import Path
import sys
import xlrd

root=Path(sys.argv[1])
fixtures=json.loads((root/'expected.json').read_text())
cell_count=0
for fixture in fixtures:
    book=xlrd.open_workbook(root/fixture['file'],formatting_info=True)
    sheet=book.sheet_by_name(fixture['sheet'])
    for expected in fixture['cells']:
        value=expected['value']
        text=value.get('text') if isinstance(value,dict) else '' if value is None else value
        cell=sheet.cell(expected['row'],expected['col'])
        assert cell.value==text,(fixture['file'],expected['address'],cell.value,text)
        style=book.xf_list[cell.xf_index]
        assert cell.xf_index==expected['style']
        assert bool(style.alignment.text_wrapped)==expected['wrap']
        assert book.font_list[style.font_index].height/20==expected['size']
        if isinstance(value,dict) and value.get('runs'):
            assert sheet.rich_text_runlist_map[expected['row'],expected['col']]==[(run['start'],run['fontIndex']) for run in value['runs']]
        cell_count+=1

pdf_results=[]
for kind,pages in [('general',2),('student',1)]:
    file=root/f'{kind}-full-fit.pdf'
    if not file.exists():
        continue
    import pdfplumber
    fixture=next(item for item in fixtures if item['file']==f'{kind}-full-fit.xls')
    with pdfplumber.open(file) as pdf:
        assert len(pdf.pages)==pages
        page=pdf.pages[0]
        assert abs(page.width-595.28)<1 and abs(page.height-841.89)<1
        raw=''.join(char['text'] for char in page.chars)
        raw_chars=[char for char in page.chars for _ in char['text']]
        for expected in fixture['cells']:
            if expected['address'] not in ['C9','C14','C26']:
                continue
            value=expected['value']
            text=value.get('text') if isinstance(value,dict) else value or ''
            start=raw.index(str(text)[:5])
            first=raw_chars[start]
            bottom=min((edge for edge in page.edges if edge.get('orientation')=='h' and edge['x0']<=first['x0'] and edge['x1']>first['x0']+20 and edge['top']>first['top']+2),key=lambda edge:edge['top'])
            cropped=page.crop((first['x0']-1,first['top']-2,bottom['x1'],bottom['top']+0.1))
            extracted=''.join(cropped.extract_text().split())
            assert ''.join(str(text).split()) in extracted,(kind,expected['address'],'rendered text missing')
        assert all(0<=char['x0']<=char['x1']<=page.width and 0<=char['top']<=char['bottom']<=page.height for char in page.chars)
        pdf_results.append({'kind':kind,'pages':pages,'mainPage':'A4 portrait single page','purposeWorkNotes':'complete','allGlyphsInsidePage':True})
result={'nativeFiles':len(fixtures),'exactCellsWithFontWrapAndRichText':cell_count,'pdfChecks':pdf_results}
(root/'verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(result,ensure_ascii=False,indent=2))
