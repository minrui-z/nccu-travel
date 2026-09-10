import sys,pathlib,json,hashlib,struct
import xlrd
ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=ROOT/'public'/'templates'
variants=json.loads((OUT/'variants.json').read_text())
def rgb(w,index):
    c=w.colour_map.get(index)
    return '#%02x%02x%02x'%c if c else None
for v in variants:
    path=OUT/v['file'];w=xlrd.open_workbook(path,formatting_info=True)
    fonts=[{'name':f.name,'size':f.height/20,'bold':bool(f.bold),'italic':bool(f.italic),'underline':f.underline_type,'color':rgb(w,f.colour_index)} for f in w.font_list]
    styles=[]
    for x in w.xf_list:
        a=x.alignment;b=x.border
        styles.append({'fontIndex':x.font_index,'numberFormat':w.format_map[x.format_key].format_str,'horizontal':a.hor_align,'vertical':a.vert_align,'wrap':bool(a.text_wrapped),'rotation':a.rotation,'shrinkToFit':bool(a.shrink_to_fit),'indent':a.indent_level,'fill':rgb(w,x.background.pattern_colour_index) if x.background.fill_pattern else None,'borders':{edge:{'style':getattr(b,edge+'_line_style'),'color':rgb(w,getattr(b,edge+'_colour_index'))} for edge in ['left','right','top','bottom']}})
    sheets=[]
    for si,s in enumerate(w.sheets()):
        printRows=32 if v['kind']=='general' and si==0 else 33 if v['kind']=='student' else 12
        printCols=14 if si==0 else 9
        cells=[]
        for row in range(printRows):
            for col in range(printCols):
                cell=s.cell(row,col);value=cell.value
                cells.append({'address':xlrd.formula.colname(col)+str(row+1),'row':row,'col':col,'value':value,'type':cell.ctype,'styleIndex':s.cell_xf_index(row,col),'runs':[{'start':r,'fontIndex':f} for r,f in s.rich_text_runlist_map.get((row,col),[])]})
        merges=[{'r1':r1,'r2':r2-1,'c1':c1,'c2':c2-1} for r1,r2,c1,c2 in s.merged_cells]
        sheets.append({'name':s.name,'printArea':f'A1:{xlrd.formula.colname(printCols-1)}{printRows}','paper':'A4','orientation':'portrait','fitWidth':1,'fitHeight':1,'rowHeights':[s.rowinfo_map[row].height/20 if row in s.rowinfo_map else s.default_row_height/20 for row in range(printRows)],'columnWidths':[s.colinfo_map[col].width if col in s.colinfo_map else 2048 for col in range(printCols)],'merges':merges,'cells':cells,'drawing':{'text':'出差人\n(計畫主持人)','range':'A27:B29'} if si==0 and v['kind']=='general' else None})
    fields={'name':'B8','identity':'F8' if v['kind']=='general' else 'G8','title':'I8' if v['kind']=='general' else 'M8','grade':'M8' if v['kind']=='general' else None,'reason':'C9','period':'A10','total':'C25','notes':'C26','amountDigits':[xlrd.formula.colname(c)+'7' for c in range(3 if v['kind']=='general' else 4,11 if v['kind']=='general' else 12)]}
    rowFields={'month':11,'day':12,'location':13,'work':14,'flight':15,'ship':16,'land':17,'living':18,'handling':19,'insurance':20,'registration':21,'misc':22,'deduction':23,'receipt':24}
    segmentFields=[]
    for i,(c1,c2) in enumerate(v['ranges']):
        f={key:xlrd.formula.colname(c1)+str(row) for key,row in rowFields.items()}
        if v['kind']=='student' and v['segmentCount']==7 and i<6:f['work']='C14'
        segmentFields.append({'startCol':c1,'endCol':c2,'fields':f})
    manifest={**v,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'fields':fields,'segments':segmentFields,'fonts':fonts,'styles':styles,'sheets':sheets,'formatVersion':1,'sourceVersion':'115年1月','limits':{'maxTextLength':2048,'maxSegments':12}}
    (OUT/(v['id']+'.json')).write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':'))+'\n')
    print(v['id'],len(cells),'cells',len(styles),'styles')
