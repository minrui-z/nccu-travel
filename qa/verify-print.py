"""Optional rendering QA. Pass an explicit approved headless soffice binary.
python qa/verify-print.py --output qa-output --soffice /path/to/soffice --font-dir /path/to/fonts
"""
import argparse,json,os,pathlib,subprocess,tempfile,xml.sax.saxutils
from pypdf import PdfReader
parser=argparse.ArgumentParser()
parser.add_argument('--output',type=pathlib.Path,default=pathlib.Path('qa-output'))
parser.add_argument('--soffice',type=pathlib.Path,required=True,help='Approved headless renderer; on Codex macOS use the bundled override binary')
parser.add_argument('--font-dir',type=pathlib.Path,action='append',default=[])
parser.add_argument('--timeout',type=int,default=180)
args=parser.parse_args();output=args.output.resolve();report=json.loads((output/'xls-report.json').read_text())
cases={name:case for name,case in report['cases'].items() if case['type']=='variant'}
pdfdir=output/'pdf';pdfdir.mkdir(parents=True,exist_ok=True)
for name in cases:
    target=pdfdir/f'{name}.pdf'
    if target.exists():target.unlink()  # Never mistake a stale PDF for a fresh successful conversion.
with tempfile.TemporaryDirectory(prefix='nccu-xls-qa-') as tempdir:
    tmp=pathlib.Path(tempdir);env=os.environ.copy()
    # Every run has a fresh writable profile; all 24 files share the exact same
    # renderer process and font configuration within this run.
    if args.font_dir:
        dirs=''.join(f'<dir>{xml.sax.saxutils.escape(str(path.resolve()))}</dir>' for path in args.font_dir)
        config=tmp/'fonts.conf';config.write_text('<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig>'+dirs+f'<cachedir>{tmp / "font-cache"}</cachedir></fontconfig>')
        env['FONTCONFIG_FILE']=str(config)
    renderer=args.soffice.resolve();env['PATH']=str(renderer.parent)+os.pathsep+env.get('PATH','')
    command=[str(renderer),'-env:UserInstallation='+ (tmp/'office-profile').as_uri(),'--headless','--convert-to','pdf','--outdir',str(pdfdir),*[str(output/case['file']) for case in cases.values()]]
    result=subprocess.run(command,env=env,text=True,capture_output=True,timeout=args.timeout)
    if result.returncode:raise RuntimeError(f'Headless conversion failed: {result.stdout}\n{result.stderr}')
    results=[]
    for name,case in cases.items():
        path=pdfdir/f'{name}.pdf';assert path.is_file(),f'Missing output: {name}'
        pdf=PdfReader(path);expected=2 if case['kind']=='general' else 1
        assert len(pdf.pages)==expected,(name,'page count',len(pdf.pages),expected)
        dimensions=[]
        for page in pdf.pages:
            w,h=float(page.mediabox.width),float(page.mediabox.height)
            assert abs(w-595.28)<1 and abs(h-841.89)<1,(name,'A4 portrait',w,h)
            dimensions.append([round(w,2),round(h,2)])
        if expected==2:
            assert '附表' in (pdf.pages[1].extract_text() or ''),(name,'page 2 is not the original attachment')
        results.append({'id':name,'pages':len(pdf.pages),'expectedPages':expected,'dimensionsPt':dimensions,'passed':True})
        print(f'PASS {name}: {len(pdf.pages)} A4 portrait page(s)'+ ('; page 2 is original attachment' if expected==2 else ''))
    final={'passed':True,'variantCount':len(results),'fontConfiguration':'explicit font directories' if args.font_dir else 'renderer defaults','singleRendererProcess':True,'freshProfile':True,'pixelIdentityVerified':False,'results':results}
    (output/'print-report.json').write_text(json.dumps(final,indent=2)+'\n')
    print(f'PASS all {len(results)} print variants. This checks page containment, not identical font rendering.')
