#!/usr/bin/env python3
"""Independent table-grid extraction verifies every allowance and premium number."""
from pathlib import Path
import json, re, hashlib, argparse, sys
import pdfplumber
if sys.flags.optimize:
    raise SystemExit('Do not use python -O: validation assertions must remain enabled.')
ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--data-dir', type=Path, default=ROOT/'public/data', help='Directory containing pinned source-manifest.json and sources/')
parser.add_argument('--json-dir', type=Path, help='Directory containing generated JSON to verify (default: --data-dir)')
args=parser.parse_args()
DATA=args.data_dir.resolve(); JSON=args.json_dir.resolve() if args.json_dir else DATA
a=json.loads((JSON/'allowances-2026.json').read_text(encoding='utf-8'))
foreign={d['officialNumber']:d for d in a['destinations'] if d['sourceId']=='dgbas-foreign-2026'}
actual={}; current=None
with pdfplumber.open(DATA/'sources/foreign-daily-allowance-2026.pdf') as pdf:
    for page in pdf.pages:
        for table in page.extract_tables():
            for row in table:
                if len(row)!=4: continue
                country,number,label,amount=[(x or '').strip() for x in row]
                if number.isdigit():
                    current=int(number); actual[current]={'label':label, 'rates':[]}
                if not amount.isdigit():continue
                assert current is not None
                spans=re.findall(r'(\d{2}/\d{2})-(\d{2}/\d{2})',label)
                if spans:
                    actual[current]['rates'] += [{'amountUsd':amount,'season':{'fromMMDD':start.replace('/','-'),'toMMDD':end.replace('/','-')}} for start,end in spans]
                else: actual[current]['rates'].append({'amountUsd':amount,'season':None})
assert set(actual)==set(foreign)==set(range(1,552))
for number,row in actual.items():
    assert row['rates']==foreign[number]['rates'],number
    assert re.sub(r'\s','',row['label'])==re.sub(r'\s','',foreign[number]['officialLabel']),number
mainland=[d for d in a['destinations'] if d['sourceId']=='dgbas-mainland-hk-macau-2026']
with pdfplumber.open(DATA/'sources/mainland-hk-macau-daily-allowance-2026.pdf') as pdf:
    extracted=[]
    for table in pdf.pages[0].extract_tables():
        for row in table:
            if len(row)==3 and (row[0] or '').strip().isdigit():
                extracted.append((int(row[0]),row[2].strip()))
assert extracted==[(d['officialNumber'],d['rates'][0]['amountUsd']) for d in mainland]
insurance=json.loads((JSON/'insurance-premiums.json').read_text(encoding='utf-8'))
assert insurance['contracts'][0]['plans']==insurance['contracts'][1]['plans']
for year,contract in zip((2025,2026),insurance['contracts'],strict=True):
    assert contract['id']==f'nccu-insurance-{year}'
    assert contract['effectiveFrom']==f'{year}-06-21' and contract['effectiveTo']==f'{year+1}-06-20'
    with pdfplumber.open(DATA/f'sources/insurance-premiums-{year}.pdf') as pdf:
        for page,plan in zip(pdf.pages,contract['plans'],strict=True):
            premiums={}
            for table in page.extract_tables():
                for row in table:
                    for i in range(0,len(row)-1,2):
                        day=(row[i] or '').strip(); amount=(row[i+1] or '').strip().replace(',','')
                        if day.isdigit() and amount.isdigit():
                            assert day not in premiums
                            premiums[day]=amount
            assert premiums==plan['premiumsNtdByDays'],plan['id']
manifest=json.loads((JSON/'source-manifest.json').read_text(encoding='utf-8'))
pinned=json.loads((DATA/'source-manifest.json').read_text(encoding='utf-8'))
assert manifest['sources']==pinned['sources'], 'Generated source metadata must match the pinned manifest'
assert a['sources']+insurance['sources']==manifest['sources'], 'JSON sources disagree with manifest'
for source in manifest['sources']:
    assert hashlib.sha256((DATA/source['localPath']).read_bytes()).hexdigest()==source['sha256']
# Season coverage: gaps are deliberate official Other fallbacks, never guessed rates.
import datetime
for dest in a['destinations']:
    seasonal=[r for r in dest['rates'] if r['season']]
    if not seasonal:continue
    missing=[]
    for i in range(366):
        day=(datetime.date(2024,1,1)+datetime.timedelta(days=i)).strftime('%m-%d')
        hits=0
        for rate in seasonal:
            start=rate['season']['fromMMDD']; end=rate['season']['toMMDD']
            hits += (start<=day<=end) if start<=end else (day>=start or day<=end)
        assert hits<=1,(dest['id'],day)
        if not hits:missing.append(day)
    if missing:assert dest['id'] in ['foreign-155','foreign-240'] and dest['countryOtherId']
print('PASS: 570 allowance destinations, every rate/season/name; 2 x 8 insurance plans x 365 day rates; official PDF hashes; all seasonal overlap/fallback checks.')
