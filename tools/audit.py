"""OScope UI audit. Opens every lab in a real browser (Playwright + Chromium) and reports:
   sideways overflow at 5 widths, console errors, "NaN/undefined" text, duplicate ids, unlabeled controls,
   small touch targets, text contrast (light and dark), fuzzed inputs, keyboard shortcuts, routing/history,
   blocked storage, print stylesheet, memory use.
   Run:  pip install playwright && playwright install chromium && python3 tools/audit.py
   (set CHROMIUM=/path/to/chromium to use an existing browser). Exit code 1 if any problem category is reported.
   Contrast inside SVG drawings can read as a false alarm because the checker only sees CSS backgrounds."""
import json, re, sys, time, os, glob, collections
from playwright.sync_api import sync_playwright
ROOT=os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)),'..')); URL='file://'+ROOT+'/index.html'
ids=sorted(os.path.basename(f)[:-3] for f in glob.glob(ROOT+'/js/labs/*.js')); R=collections.defaultdict(list)
def add(cat,msg): R[cat].append(msg)

# ---------- A. static
idx=open(ROOT+'/index.html').read()
tags=re.findall(r'src="([^"]+)"',idx)
for t in tags:
    if not os.path.exists(ROOT+'/'+t): add('static','missing file for script tag '+t)
hrefs=re.findall(r'href="(css/[^"]+)"',idx)
for h in hrefs:
    if not os.path.exists(ROOT+'/'+h): add('static','missing css '+h)
for f in glob.glob(ROOT+'/js/**/*.js',recursive=True)+glob.glob(ROOT+'/css/*.css'):
    rel=os.path.relpath(f,ROOT)
    if rel not in tags and rel not in hrefs: add('static','file not loaded by index.html: '+rel)
sz=sum(os.path.getsize(f) for f in glob.glob(ROOT+'/**/*',recursive=True) if os.path.isfile(f) and '/tests/' not in f)
add('info','app payload (no tests) %.0f KB'%(sz/1024))

JS_DUP="""()=>{const m={};document.querySelectorAll('[id]').forEach(e=>m[e.id]=(m[e.id]||0)+1);return Object.entries(m).filter(([k,v])=>v>1).map(([k,v])=>k+'x'+v)}"""
JS_A11Y="""()=>{const out=[];const name=e=>(e.getAttribute('aria-label')||e.getAttribute('aria-labelledby')||e.getAttribute('title')||e.innerText||e.textContent||'').trim();
document.querySelectorAll('main button').forEach(b=>{if(!name(b)&&!b.querySelector('svg title'))out.push('button no name: '+b.outerHTML.slice(0,80))});
document.querySelectorAll('main input,main select,main textarea').forEach(i=>{if(i.type==='hidden')return;const lab=i.closest('label')||(i.id&&document.querySelector('label[for="'+i.id+'"]'));if(!lab&&!i.getAttribute('aria-label')&&!i.getAttribute('aria-labelledby')&&!i.title)out.push('input no label: <'+i.tagName.toLowerCase()+' '+(i.type||'')+' '+(i.placeholder||'')+'>')});
document.querySelectorAll('main img:not([alt])').forEach(i=>out.push('img no alt'));
document.querySelectorAll('main svg').forEach(s=>{if(!s.getAttribute('aria-hidden')&&!s.getAttribute('role')&&!s.getAttribute('aria-label')&&s.closest('main')&&s.getBoundingClientRect().width>120)out.push('large svg without role/label')});
return [...new Set(out)]}"""
JS_OVER="""()=>{const W=document.documentElement.clientWidth;const bad=[];document.querySelectorAll('main *').forEach(e=>{const r=e.getBoundingClientRect();if(r.width===0)return;if(r.right>W+2){let p=e.parentElement,clipped=false;while(p&&p!==document.body){const o=getComputedStyle(p).overflowX;if((o==='auto'||o==='scroll'||o==='hidden')&&p.getBoundingClientRect().right<=W+2){clipped=true;break}p=p.parentElement}if(!clipped)bad.push(e.tagName.toLowerCase()+'.'+(e.className&&e.className.baseVal===undefined?e.className:'').toString().split(' ')[0])}});return [...new Set(bad)].slice(0,4)}"""
JS_SMALL="""()=>{const s=[];document.querySelectorAll('main button, main a, main input, main select, #app .rail button').forEach(e=>{const r=e.getBoundingClientRect();if(r.width&&(r.height<24||r.width<24)&&getComputedStyle(e).visibility!=='hidden')s.push((e.getAttribute('aria-label')||e.innerText||e.type||e.tagName).toString().slice(0,18)+' '+Math.round(r.width)+'x'+Math.round(r.height))});return [...new Set(s)].slice(0,5)}"""
JS_CONTRAST="""()=>{function parse(c){const m=c.match(/rgba?\\(([^)]+)\\)/);if(!m)return null;const p=m[1].split(',').map(x=>parseFloat(x));return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1}}
function lum(c){const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)};return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b)}
function bg(e){let layers=[];while(e){const c=parse(getComputedStyle(e).backgroundColor);if(c&&c.a>0){layers.push(c);if(c.a>=1)break}e=e.parentElement}let base={r:255,g:255,b:255};if(!layers.length||layers[layers.length-1].a<1){const b=parse(getComputedStyle(document.body).backgroundColor);base=b&&b.a>0?b:{r:19,g:27,b:48}}for(let i=layers.length-1;i>=0;i--){const l=layers[i];base={r:l.r*l.a+base.r*(1-l.a),g:l.g*l.a+base.g*(1-l.a),b:l.b*l.a+base.b*(1-l.a)}}return base}
const out=[];const seen=new Set();document.querySelectorAll('main *, .rail *, .topbar *').forEach(e=>{if(![...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()))return;const cs=getComputedStyle(e);if(cs.visibility==='hidden'||cs.display==='none')return;if(e.closest(':disabled, .future'))return;   /* disabled controls and deliberately faded 'not happened yet' items are exempt */const r=e.getBoundingClientRect();if(!r.width||!r.height)return;let op=1,p=e;while(p){op*=parseFloat(getComputedStyle(p).opacity);p=p.parentElement}const fg=parse(cs.color);if(!fg)return;const b=bg(e);const fa={r:fg.r*fg.a*op+b.r*(1-fg.a*op),g:fg.g*fg.a*op+b.g*(1-fg.a*op),b:fg.b*fg.a*op+b.b*(1-fg.a*op)};const L1=lum(fa),L2=lum(b);const ratio=(Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05);const size=parseFloat(cs.fontSize);const need=(size>=24||(size>=18.66&&parseInt(cs.fontWeight)>=700))?3:4.5;if(ratio<need){const k=(e.className&&e.className.baseVal===undefined?e.className:e.tagName)+'|'+ratio.toFixed(1);if(!seen.has(k)){seen.add(k);out.push(k+' "'+e.textContent.trim().slice(0,22)+'"')}}});return out.slice(0,6)}"""
JS_BAD_TXT="""()=>{const t=document.querySelector('main').innerText;return (t.match(/\\b(null|undefined|NaN|Infinity|\\[object \\w+\\])\\b/g)||[])}"""

LAUNCH={'executable_path':os.environ['CHROMIUM']} if os.environ.get('CHROMIUM') else {}
with sync_playwright() as p:
    b=p.chromium.launch(**LAUNCH)
    # ---------- B. per lab x width
    for w,h in ((1440,900),(1024,768),(768,1024),(390,800),(320,640)):
        pg=b.new_page(viewport={'width':w,'height':h}); errs=[]
        pg.on('pageerror',lambda e:errs.append(str(e)))
        pg.on('console',lambda m:errs.append(m.text) if m.type=='error' and 'fonts.g' not in m.text and 'ERR_' not in m.text and 'Failed to load' not in m.text else None)
        pg.goto(URL); pg.evaluate("localStorage.setItem('oslab.advanced','true')")
        for i in ids:
            errs.clear(); t0=time.time(); pg.goto(URL+'#'+i); pg.reload(); pg.wait_for_timeout(200); load=time.time()-t0
            ov=pg.evaluate("document.documentElement.scrollWidth-document.documentElement.clientWidth")
            if ov>2: add('overflow',f'{w}px {i}: page scrolls sideways by {ov}px')
            el=pg.evaluate(JS_OVER)
            if el: add('overflow',f'{w}px {i}: elements past right edge {el}')
            if errs: add('errors',f'{w}px {i}: {errs[:2]}')
            bt=pg.evaluate(JS_BAD_TXT)
            if bt: add('text',f'{w}px {i}: {bt[:3]}')
            if w==1440:
                d=pg.evaluate(JS_DUP)
                if d: add('dup-ids',f'{i}: {d}')
                a=pg.evaluate(JS_A11Y)
                if a: add('a11y',f'{i}: {a[:3]}')
                if load>3: add('perf',f'{i}: slow load {load:.1f}s')
            if w==390:
                s=pg.evaluate(JS_SMALL)
                if s: add('touch-targets',f'{i}: {s}')
        pg.close()
    # ---------- C. contrast light & dark
    for scheme in ('light','dark'):
        ctx=b.new_context(viewport={'width':1280,'height':900},color_scheme=scheme); pg=ctx.new_page()
        pg.goto(URL); pg.evaluate("localStorage.setItem('oslab.advanced','true')")
        for i in ids:
            pg.goto(URL+'#'+i); pg.reload(); pg.wait_for_timeout(150)
            pg.wait_for_timeout(200); pg.evaluate("document.getAnimations().forEach(a=>{try{a.finish()}catch(e){}})"); c=pg.evaluate(JS_CONTRAST)
            if c: add('contrast-'+scheme,f'{i}: {c[:4]}')
        ctx.close()
    # ---------- D. fuzz inputs
    fz=['abc','-5','0','999999','','1e9','3.7','   ','a b c\n\n\n','1 2 3\n4 5','P1 0 5\nP1 0 5','-1 -1 -1']
    pg=b.new_page(viewport={'width':1280,'height':900}); errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.on('console',lambda m:errs.append(m.text) if m.type=='error' and 'fonts.g' not in m.text and 'ERR_' not in m.text and 'Failed to load' not in m.text else None)
    pg.goto(URL); pg.evaluate("localStorage.setItem('oslab.advanced','true')")
    for i in ids:
        pg.goto(URL+'#'+i); pg.reload(); pg.wait_for_timeout(150)
        n=pg.locator('.problem input[type=text],.problem input[type=number],.problem textarea:visible').count()
        hung=0; bad=set()
        for k in range(min(n,14)):
            for v in fz:
                errs.clear()
                try:
                    loc=pg.locator('.problem input[type=text],.problem input[type=number],.problem textarea').nth(k)
                    if not loc.is_visible(): break
                    t0=time.time()
                    loc.evaluate("(e,v)=>{e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))}",v)
                    pb=pg.locator('.problem .btn.primary:visible')
                    if pb.count(): pb.first.click(timeout=1500)
                    pg.wait_for_timeout(30)
                    dt=time.time()-t0
                    if dt>3: hung+=1; add('fuzz-slow',f'{i} field#{k} value {v!r}: {dt:.1f}s')
                    bt=pg.evaluate(JS_BAD_TXT)
                    if bt: bad.add(f'field#{k} {v!r} -> {bt[:2]}')
                    if errs: bad.add(f'field#{k} {v!r} -> JS error {errs[0][:90]}')
                except Exception as ex:
                    bad.add(f'field#{k} {v!r}: harness {str(ex)[:60]}')
        for x in sorted(bad)[:4]: add('fuzz',f'{i}: {x}')
    pg.close()
    # ---------- E. keyboard / shortcuts / app-level
    pg=b.new_page(viewport={'width':1280,'height':900}); errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto(URL+'#scheduling'); pg.wait_for_timeout(300)
    # typing in a field must not trigger player shortcuts
    f=pg.locator('.problem input[type=number]').first; f.click(); before=pg.inner_text('.readout') if pg.query_selector('.readout') else ''
    pg.keyboard.press('Space'); pg.keyboard.press('ArrowRight'); pg.wait_for_timeout(200)
    after=pg.inner_text('.readout') if pg.query_selector('.readout') else ''
    if before!=after: add('keyboard',f'Space/Arrow typed inside an input changed the player ({before!r} -> {after!r})')
    # tab order reach
    pg.goto(URL+'#scheduling'); pg.wait_for_timeout(200)
    seen=[]; 
    for _ in range(60):
        pg.keyboard.press('Tab'); seen.append(pg.evaluate("(()=>{const e=document.activeElement;const cs=getComputedStyle(e);return [e.tagName,(e.innerText||e.getAttribute('aria-label')||'').slice(0,14),cs.outlineStyle,cs.boxShadow!=='none'].join('|')})()"))
    noout=[s for s in seen if s.split('|')[2]=='none' and s.split('|')[3]=='false' and not s.startswith('BODY')]
    if noout: add('keyboard','focus without visible ring on: '+', '.join(noout[:5]))
    # skip link / landmarks
    lm=pg.evaluate("[!!document.querySelector('main'),!!document.querySelector('nav'),!!document.querySelector('header'),!!document.querySelector('h1'),document.documentElement.lang]")
    if not lm[4]: add('a11y','<html lang> missing (stripped wrapper in published build; check local index.html too)')
    # advanced toggle persistence / hash handling / search
    pg.goto(URL+'#doesnotexist'); pg.wait_for_timeout(200)
    if pg.query_selector('main h2') is None: add('routing','invalid hash shows nothing')
    pg.goto(URL+'#scheduling'); pg.evaluate("localStorage.clear()"); pg.reload(); pg.wait_for_timeout(200)
    n0=pg.locator('.rail-item').count()
    pg.click('.adv-switch'); n1=pg.locator('.rail-item').count()
    pg.reload(); pg.wait_for_timeout(200); n2=pg.locator('.rail-item').count()
    add('info',f'sidebar rows: core {n0}, with advanced {n1}, after reload {n2}')
    if n2!=n1: add('state','advanced switch not remembered after reload')
    pg.keyboard.press('Control+k'); pg.wait_for_timeout(150); pg.keyboard.type('zzzz'); pg.wait_for_timeout(100)
    if not pg.query_selector('.sr-empty'): add('search','no empty-state for unknown query')
    pg.keyboard.press('Escape')
    # advanced lab hash while switch off
    pg.evaluate("localStorage.setItem('oslab.advanced','false')"); pg.goto(URL+'#raft'); pg.reload(); pg.wait_for_timeout(250)
    st=pg.evaluate("document.querySelector('.adv-switch input').checked")
    if not st: add('state','opening an advanced lab link leaves the Advanced switch OFF (inconsistent)')
    # back/forward
    pg.goto(URL+'#scheduling'); pg.wait_for_timeout(150); pg.click('.rail-item:has-text("Process states")'); pg.wait_for_timeout(150); pg.go_back(); pg.wait_for_timeout(250)
    h=pg.evaluate('location.hash')
    if h!='#scheduling': add('routing',f'browser Back does not return to previous lab (hash {h}); replaceState used so history is not recorded')
    # localStorage blocked
    ctx=b.new_context(); ctx.add_init_script("Object.defineProperty(window,'localStorage',{get(){throw new Error('blocked')}})"); q=ctx.new_page(); e2=[]
    q.on('pageerror',lambda e:e2.append(str(e))); q.goto(URL+'#scheduling'); q.wait_for_timeout(300)
    if e2 or not q.query_selector('main h2'): add('state',f'app fails with storage blocked: {e2[:1]}')
    ctx.close()
    # reduced motion + 200% zoom-ish (640px wide)
    # forced colors / print
    pg.emulate_media(media='print'); pg.goto(URL+'#scheduling'); pg.wait_for_timeout(200)
    add('info','print stylesheet: '+('present' if 'print' in idx or any('@media print' in open(f).read() for f in glob.glob(ROOT+'/css/*.css')) else 'none (sidebar/topbar will print)'))
    # heap / mount-all stress
    pg=b.new_page(viewport={'width':1280,'height':900}); pg.goto(URL); pg.evaluate("localStorage.setItem('oslab.advanced','true')"); pg.reload(); t0=time.time()
    for i in ids: pg.evaluate("(i)=>{location.hash=i}",i); pg.wait_for_timeout(60)
    heap=pg.evaluate("performance.memory?performance.memory.usedJSHeapSize/1048576:-1"); nodes=pg.evaluate("document.getElementsByTagName('*').length")
    add('info',f'after opening all {len(ids)} labs in one session: {nodes} DOM nodes, heap {heap:.0f} MB, {time.time()-t0:.1f}s')
    b.close()
BAD=0
for k,v in R.items():
    if k!='info': BAD+=len(v)
    print('==',k,len(v))
    for x in v[:25]: print('  ',x)
    if len(v)>25: print('   ... +%d more'%(len(v)-25))

sys.exit(1 if BAD else 0)
