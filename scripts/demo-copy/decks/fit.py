import sys, zipfile, re, math, xml.dom.minidom as m
EMU=914400
for f in sys.argv[1:]:
    z=zipfile.ZipFile(f)
    slides=sorted([n for n in z.namelist() if re.match(r'ppt/slides/slide\d+\.xml$',n)], key=lambda n:int(re.findall(r'\d+',n)[0]))
    for n in slides:
        d=m.parseString(z.read(n))
        for sp in d.getElementsByTagName('p:sp'):
            ext=sp.getElementsByTagName('a:ext'); off=sp.getElementsByTagName('a:off')
            if not ext: continue
            w=int(ext[0].getAttribute('cx'))/EMU; h=int(ext[0].getAttribute('cy'))/EMU
            x=int(off[0].getAttribute('x'))/EMU; y=int(off[0].getAttribute('y'))/EMU
            if x+w>10.01 or y+h>5.63: print(f,n,'OFF SLIDE',round(x,2),round(y,2),round(w,2),round(h,2))
            lines=0; size=None
            for p in sp.getElementsByTagName('a:p'):
                txt=''.join(t.firstChild.data for t in p.getElementsByTagName('a:t') if t.firstChild)
                if not txt: continue
                rp=p.getElementsByTagName('a:rPr')
                sz=int(rp[0].getAttribute('sz'))/100 if rp and rp[0].getAttribute('sz') else 18
                bold=rp and rp[0].getAttribute('b')=='1'
                cw=sz/72*(0.53 if bold else 0.5)
                bullet = 0.3 if p.getElementsByTagName('a:buChar') else 0
                per=max(1,int((w-bullet)/cw))
                # word wrap
                l=1;cur=0
                for word in txt.split(' '):
                    if cur+len(word)>per and cur>0: l+=1;cur=len(word)+1
                    else: cur+=len(word)+1
                lines+=l*sz*1.2/72 + (0.1 if bullet else 0)
                size=sz
            if size and lines>h+0.02:
                print(f'{f[:6]} {n[11:]} need {lines:.2f} have {h:.2f} sz{size}:', txt[:50])
