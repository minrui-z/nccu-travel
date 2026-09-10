"""Independent reader: python qa/verify-reopen.py --output qa-output"""
import argparse,json,pathlib,re
import xlrd
parser=argparse.ArgumentParser();parser.add_argument('--output',type=pathlib.Path,default=pathlib.Path('qa-output'))
args=parser.parse_args();report=json.loads((args.output/'xls-report.json').read_text());checked=0
for name,case in report['cases'].items():
    book=xlrd.open_workbook(args.output/case['file'],formatting_info=True);sheet=book.sheet_by_name(case['sheet'])
    for address,want in case['changes'].items():
        letters,row=re.fullmatch(r'([A-Z]+)([0-9]+)',address).groups();col=0
        for letter in letters:col=col*26+ord(letter)-64
        r,c=int(row)-1,col-1;cell=sheet.cell(r,c)
        expected=want.get('text') if isinstance(want,dict) else '' if want is None else want
        assert cell.value==expected,(name,address,cell.value,expected)
        if isinstance(want,(float,int)):assert cell.ctype==xlrd.XL_CELL_NUMBER,(name,address,'numeric type')
        if isinstance(want,dict) and want.get('runs'):
            runs=[(run['start'],run['fontIndex']) for run in want['runs']]
            assert sheet.rich_text_runlist_map[r,c]==runs,(name,address,'rich-text runs')
        checked+=1
    print('PASS independent xlrd values, types and rich text:',name)
result={'passed':True,'reader':'xlrd','version':xlrd.__version__,'caseCount':len(report['cases']),'checkedCells':checked}
(args.output/'reopen-report.json').write_text(json.dumps(result,indent=2)+'\n')
print(f'PASS {checked} cells across {len(report["cases"])} workbooks')
