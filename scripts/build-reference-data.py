#!/usr/bin/env python3
"""Rebuild reviewed 2026 reference JSON from pinned, official public PDFs.
Requires Python 3.10+ and pypdf. On Codex/macOS, use the loaded workspace Python.
This reviewed parser supports the pinned 2026 PDFs only; it never downloads data.
"""
from pathlib import Path
from pypdf import PdfReader
import re, json, hashlib, datetime, argparse, sys

if sys.flags.optimize:
    raise SystemExit("Do not use python -O: validation assertions must remain enabled.")

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--data-dir', type=Path, default=ROOT / 'public/data', help='Directory containing source-manifest.json and sources/')
parser.add_argument('--output-dir', type=Path, help='Write the three regenerated JSON files here (default: --data-dir)')
args = parser.parse_args()
DATA = args.data_dir.resolve()
OUTPUT = args.output_dir.resolve() if args.output_dir else DATA
SOURCES = DATA / 'sources'
NOW = datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z')
MANIFEST_PATH = DATA / 'source-manifest.json'
OLD_SOURCES = json.loads(MANIFEST_PATH.read_text(encoding='utf-8'))['sources']
if len({item['id'] for item in OLD_SOURCES}) != len(OLD_SOURCES):
    raise ValueError('Duplicate source IDs in source-manifest.json')
SOURCE_BY_ID = {item['id']: item for item in OLD_SOURCES}
FOREIGN_URL = 'https://law.dgbas.gov.tw/Download.ashx?FileID=3648&id=21709&type=ANN'
MAINLAND_URL = 'https://law.dgbas.gov.tw/Download.ashx?FileID=3650&id=21710&type=ANN'


def source(source_id, filename, url, title, **extra):
    path = SOURCES / filename
    data = path.read_bytes()
    assert data.startswith(b'%PDF-'), filename
    digest = hashlib.sha256(data).hexdigest()
    previous = SOURCE_BY_ID[source_id]
    if previous['url'] != url or previous['localPath'] != f'sources/{filename}':
        raise ValueError(f'{source_id}: source URL/path differs from the reviewed source')
    if previous['sha256'] != digest:
        raise ValueError(f'{filename}: PDF hash does not match manifest; review official changes before updating the pin')
    retrieved_at = previous['retrievedAt']
    return dict(id=source_id, title=title, url=url, localPath=f'sources/{filename}',
                sha256=digest, retrievedAt=retrieved_at, **extra)


def write(name, data):
    OUTPUT.mkdir(parents=True, exist_ok=True)
    temporary = OUTPUT / f'.{name}.tmp'
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(OUTPUT / name)


def split_name(text):
    text = re.sub(r'\s+', ' ', text).strip()
    zh = re.sub(r'\([^)]*\)', '', text).strip().replace('/ ', '/')
    en = ' / '.join(re.findall(r'\(([^)]*)\)', text)) or None
    return zh, en


def foreign_destinations():
    rows, current, country = [], None, None
    region = None
    country_number = 0
    headers = {'地區、', '國家', '城市或', '其他', '編號 名稱', '(地區、國家、城市或其他) 日支數額',
               '中央政府各機關派赴國外各地區出差人員生活費日支數額表', '單位：美元'}

    def flush():
        nonlocal current
        if not current: return
        label = ' '.join(current.pop('_parts'))
        amount = re.search(r'\s(\d+)$', label)
        if amount:
            current['rates'].append({'amountUsd': amount[1], 'season': None})
            label = label[:amount.start()].strip()
        assert current['rates'], current
        current['officialLabel'] = label
        if current['isCountryWide']:
            country['label'] = label
        cz, ce = split_name(country['label'])
        current.update(countryId=country['id'], countryZh=cz, countryEn=ce)
        if current['isCountryWide']:
            current.update(cityZh='全國', cityEn='All destinations')
        else:
            zh, en = split_name(label)
            current.update(cityZh=zh, cityEn=en)
        current['isCountryOther'] = current['cityZh'] == '其他'
        rows.append(current)
        current = None

    reader = PdfReader(SOURCES / 'foreign-daily-allowance-2026.pdf')
    for page_index, page in enumerate(reader.pages, 1):
        for line in page.extract_text().splitlines():
            line = line.strip()
            if line.startswith(('中 華 民 國', '附註：')): break
            if not line or line in headers or line.startswith('第 ') or line.startswith('行政院') or '生 效' in line: continue
            match = re.match(r'^([A-F]) (.+地區)$', line)
            if match:
                flush(); region = {'code': match[1], 'nameZh': match[2]}; continue
            match = re.match(r'^([一二三四五六七八九十0]+) (.+)$', line)
            is_country_wide = False
            if match:
                flush(); country_number += 1
                country = {'id': f'foreign-country-{country_number:03}', 'label': match[2]}
                if not re.match(r'^\d+(?:\s|$)', match[2]): continue
                line = match[2]; is_country_wide = True
            match = re.match(r'^(\d+)(?:\s+(.*))?$', line)
            if match:
                flush()
                current = dict(id=f'foreign-{int(match[1]):03}', officialNumber=int(match[1]),
                               region=region, sourceId='dgbas-foreign-2026', sourcePage=page_index,
                               currency='USD', effectiveFrom='2026-01-01', isCountryWide=is_country_wide,
                               _parts=[match[2]] if match[2] else [], rates=[])
                continue
            match = re.match(r'^\((\d{2}/\d{2}.*)\) (\d+)$', line)
            if match:
                assert current, line
                for span in match[1].split(','):
                    start, end = span.strip().split('-')
                    current['rates'].append(dict(amountUsd=match[2], season=dict(fromMMDD=start.replace('/', '-'), toMMDD=end.replace('/', '-'))))
                continue
            if current:
                current['_parts'].append(line)
            elif country and line.startswith('('):
                country['label'] += ' ' + line
            else:
                raise ValueError(f'Unparsed line on page {page_index}: {line}')
    flush()
    assert [r['officialNumber'] for r in rows] == list(range(1, 552))
    assert len({r['countryId'] for r in rows}) == 200
    others = {r['countryId']: r['id'] for r in rows if r['isCountryOther']}
    for row in rows:
        row['countryOtherId'] = others.get(row['countryId'])
    return rows


def mainland_destinations():
    rows = []
    for line in PdfReader(SOURCES / 'mainland-hk-macau-daily-allowance-2026.pdf').pages[0].extract_text().splitlines():
        match = re.match(r'^(\d+) (.+) (\d+)$', line.strip())
        if not match: continue
        zh, en = split_name(match[2])
        rows.append(dict(id=f'mainland-hk-macau-{int(match[1]):02}', officialNumber=int(match[1]),
            region={'code': 'CN-HK-MO', 'nameZh': '大陸地區、香港及澳門'},
            countryId='mainland-hk-macau', countryZh='大陸地區、香港及澳門', countryEn='Mainland China, Hong Kong and Macau',
            cityZh=zh, cityEn=en, officialLabel=match[2], isCountryWide=False, isCountryOther=zh == '其他',
            countryOtherId='mainland-hk-macau-19', currency='USD', effectiveFrom='2026-01-01',
            rates=[{'amountUsd': match[3], 'season': None}], sourceId='dgbas-mainland-hk-macau-2026', sourcePage=1))
    assert len(rows) == 19
    return rows


def insurance_data():
    src, contracts = [], []
    for year in (2025, 2026):
        filename = f'insurance-premiums-{year}.pdf'
        source_id = f'nccu-insurance-{year}'
        url = SOURCE_BY_ID[source_id]['url']
        if not url.startswith('https://acc.nccu.edu.tw/sites/default/files/'):
            raise ValueError(f'{source_id}: expected an official NCCU PDF URL')
        src.append(source(source_id, filename, url, f'一般險及申根險保費表 {year}-06-21 至 {year + 1}-06-20',
            listingUrl='https://acc.nccu.edu.tw/content/%E6%97%85%E9%81%8B%E8%B2%BB',
            periodEvidence='NCCU public attachment filename; period is not printed inside PDF'))
        plans = []
        reader = PdfReader(SOURCES / filename)
        for page_index, page in enumerate(reader.pages, 1):
            lines = page.extract_text().splitlines()
            heading = lines[0].strip()
            assert heading.startswith('保障內容：')
            plan_type = 'schengen' if '申根險' in heading else 'general'
            under15 = '未滿15足歲' in heading
            match = re.search(r'(\d+(?:\.\d+)?)萬', heading)
            coverage = str(int(float(match[1]) * 10000)) if match else None
            rates = {}
            for line in lines[2:]:
                tokens = line.split()
                if not tokens: continue
                assert len(tokens) % 2 == 0, line
                for i in range(0, len(tokens), 2):
                    day = int(tokens[i]); premium = tokens[i + 1].replace(',', '')
                    assert day not in rates and premium.isdigit(), line
                    rates[day] = premium
            assert sorted(rates) == list(range(1, 366))
            plans.append(dict(id=f'{plan_type}-under15-{coverage}' if under15 else f'{plan_type}-age15plus',
                officialLabel=heading.replace('保障內容：', '').strip(), planType=plan_type,
                minAge=0 if under15 else 15, maxAgeExclusive=15 if under15 else None,
                statedCoverageNtd=coverage, sourcePage=page_index,
                premiumsNtdByDays={str(day): rates[day] for day in sorted(rates)}))
        contracts.append(dict(id=source_id, effectiveFrom=f'{year}-06-21', effectiveTo=f'{year + 1}-06-20',
            periodSelection='manual-confirm-policy-contract-period', sourceId=source_id, plans=plans))
    return dict(schemaVersion=1, currency='TWD', generatedAt=NOW, status='verified-table-with-manual-applicability',
        sources=src, contracts=contracts,
        requiredInputs=['contractId', 'planType', 'ageBand', 'insuredDays', 'actualPremiumNtd', 'insuredAmountNtd'],
        applicabilityNotes=[
            'Use the contract period applicable to the actual policy; do not assume departure date alone selects the contract.',
            'The table does not state the insured amount for age-15-plus plans. Do not infer it from the premium table.',
            'NCCU reimbursement insured-amount ceiling of NTD 4,000,000 is a separate rule; this JSON does not scale premiums by coverage.',
            'Do not extrapolate outside 1 to 365 days or a listed contract period; request an applicable official premium table.',
            'Both NCCU attachments currently contain identical PDF bytes. Each period and URL is preserved separately.'
        ])


def main():
    sources = [source('dgbas-foreign-2026','foreign-daily-allowance-2026.pdf',FOREIGN_URL,'中央政府各機關派赴國外各地區出差人員生活費日支數額表', announcementUrl='https://law.dgbas.gov.tw/NewsContent.aspx?id=21709'),
               source('dgbas-mainland-hk-macau-2026','mainland-hk-macau-daily-allowance-2026.pdf',MAINLAND_URL,'中央政府各機關派赴大陸地區、香港及澳門出差人員生活費日支數額表', announcementUrl='https://law.dgbas.gov.tw/NewsContent.aspx?id=21710')]
    foreign = foreign_destinations(); mainland = mainland_destinations()
    output = dict(schemaVersion=1, version='115-2026-01-01', effectiveFrom='2026-01-01', effectiveTo=None, currency='USD', generatedAt=NOW,
        sources=sources, destinations=foreign + mainland,
        notes=[
            {'code':'UNLISTED_CITY_OR_SEASON','sourceId':'dgbas-foreign-2026','sourcePage':28,'textZh':'未列城市或未列期間採該國其他；無其他項目時不得自行建立數額，需人工確認。'},
            {'code':'UNLISTED_COUNTRY','sourceId':'dgbas-foreign-2026','sourcePage':28,'textZh':'未列國家比照最近國家其他；地理判斷須由使用者確認，未自動推定。'},
            {'code':'OVERNIGHT_LOCATION','sourceId':'dgbas-foreign-2026','sourcePage':28,'textZh':'一日跨越兩地以上採當日留宿地區。'},
            {'code':'ROUNDING_UNRESOLVED','sourceId':'dgbas-foreign-2026','sourcePage':28,'textZh':'官方總計後不足一元進位的幣別及換匯順序仍待確認；資料表不決定計算引擎的進位口徑。'},
            {'code':'MAINLAND_OTHER','sourceId':'dgbas-mainland-hk-macau-2026','sourcePage':2,'textZh':'本表未列城市及內蒙古按其他支給。'}])
    # Parse and validate every source before replacing any JSON output.
    insurance = insurance_data()
    write('allowances-2026.json', output)
    write('insurance-premiums.json', insurance)
    write('source-manifest.json', dict(schemaVersion=1, generatedAt=NOW, sources=sources+insurance['sources']))
    print(json.dumps({'destinations':len(output['destinations']),'foreign':len(foreign),'mainlandHkMacau':len(mainland),'foreignCountries':200,'seasonalDestinations':sum(any(r['season'] for r in d['rates']) for d in foreign),'insuranceContracts':len(insurance['contracts']),'insurancePlans':sum(len(c['plans']) for c in insurance['contracts'])}))

if __name__ == '__main__': main()
