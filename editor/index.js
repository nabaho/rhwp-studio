/**
 * rhwp-studio editor/index.js
 * HWP/HWPX 뷰어 + 편집 지원 (nabaho/rhwp-studio)
 */

export async function createEditor(containerSel, options={}) {
  const container = typeof containerSel==='string'
    ? document.querySelector(containerSel)
    : containerSel;
  if(!container) throw new Error('컨테이너를 찾을 수 없습니다: '+containerSel);

  // 상태
  let _paragraphs=[], _fileName='', _modified=false, _cursorPara=0, _cursorOffset=0;

  // UI 생성
  container.innerHTML='';
  container.style.cssText='display:flex;flex-direction:column;height:100%;min-height:500px;border:1px solid #ddd;border-radius:8px;overflow:hidden;background:#fff;font-family:"나눔명조","Noto Serif KR",serif';

  // 툴바
  const toolbar=document.createElement('div');
  toolbar.style.cssText='background:#f5f5f5;border-bottom:1px solid #ddd;padding:6px 10px;display:flex;gap:6px;align-items:center;flex-wrap:wrap';
  toolbar.innerHTML=`
    <span style="font-size:12px;color:#666;font-weight:600" id="rhwp_filename">파일 없음</span>
    <span style="flex:1"></span>
    <button onclick="window._rhwpUndo&&window._rhwpUndo()" style="padding:3px 8px;border:1px solid #ccc;background:#fff;border-radius:4px;cursor:pointer;font-size:12px">↩ 실행취소</button>
    <span style="font-size:11px;color:#999" id="rhwp_status">준비</span>
  `;
  container.appendChild(toolbar);

  // 편집 영역
  const editorArea=document.createElement('div');
  editorArea.id='rhwp_editor_area';
  editorArea.style.cssText='flex:1;overflow:auto;background:#e0e0e0;padding:20px;display:flex;flex-direction:column;align-items:center;gap:16px';
  container.appendChild(editorArea);

  // 상태바
  const statusBar=document.createElement('div');
  statusBar.style.cssText='background:#f0f0f0;border-top:1px solid #ddd;padding:4px 12px;font-size:11px;color:#888;display:flex;gap:16px';
  statusBar.innerHTML='<span id="rhwp_paracount">0 문단</span><span id="rhwp_modified"></span>';
  container.appendChild(statusBar);

  function setStatus(msg){ const el=document.getElementById('rhwp_status'); if(el) el.textContent=msg; }
  function updateCounts(){ 
    const el=document.getElementById('rhwp_paracount'); if(el) el.textContent=_paragraphs.length+'문단';
    const mel=document.getElementById('rhwp_modified'); if(mel) mel.textContent=_modified?'● 수정됨':'';
  }

  // HWP 파싱 (HWPX: ZIP 기반 XML)
  async function parseHWPX(buffer){
    try{
      // JSZip 동적 로드
      if(!window.JSZip){
        await new Promise((res,rej)=>{ const s=document.createElement('script');
          s.src='https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
          s.onload=res; s.onerror=rej; document.head.appendChild(s); });
      }
      const zip=await JSZip.loadAsync(buffer);
      // HWPX 구조: Contents/section1.xml
      const sectionFile=zip.file('Contents/section0.xml')||zip.file('Contents/section1.xml');
      if(!sectionFile) return fallbackParse(buffer);
      const xml=await sectionFile.async('string');
      return parseHWPXML(xml);
    }catch(e){ return fallbackParse(buffer); }
  }

  function parseHWPXML(xml){
    const paras=[];
    // hp:p 태그 파싱
    const pMatches=xml.match(/<hp:p[\s\S]*?<\/hp:p>/g)||[];
    pMatches.forEach(p=>{
      const textMatches=p.match(/<hp:t[^>]*>([\s\S]*?)<\/hp:t>/g)||[];
      const text=textMatches.map(t=>t.replace(/<[^>]+>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ')).join('');
      paras.push({text, style:extractStyle(p)});
    });
    return paras.length ? paras : [{text:'(내용을 파싱할 수 없습니다)',style:{}}];
  }

  function extractStyle(xml){
    const style={};
    if(/<hp:title/i.test(xml)||/styleId="[^"]*title/i.test(xml)) style.heading=true;
    const szMatch=xml.match(/sz="(\d+)"/); if(szMatch) style.fontSize=parseInt(szMatch[1])/2;
    const boldMatch=xml.match(/bold="true"/i); if(boldMatch) style.bold=true;
    return style;
  }

  function fallbackParse(buffer){
    // HWP 5.0 바이너리: 텍스트 추출 (간단 버전)
    try{
      const bytes=new Uint8Array(buffer);
      const texts=[];
      // UTF-16LE 텍스트 섹션 탐색
      for(let i=0;i<bytes.length-2;i++){
        if(bytes[i]===0x0D&&bytes[i+1]===0x00){ texts.push('\n'); i++; continue; }
        const code=bytes[i]|(bytes[i+1]<<8);
        if(code>=0x20&&code<0xFFFF&&code!==0xFFFF) texts.push(String.fromCharCode(code));
        i++;
      }
      const raw=texts.join('').replace(/[^\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uD7B0-\uD7FFa-zA-Z0-9\s\.,!?:;()\-_'"]+/g,' ').trim();
      const lines=raw.split(/\n+/).filter(l=>l.trim().length>2).slice(0,100);
      return lines.length ? lines.map(l=>({text:l.trim(),style:{}})) : [{text:'텍스트를 추출할 수 없습니다. 내용을 직접 입력하세요.',style:{}}];
    }catch(e){ return [{text:'파일을 읽을 수 없습니다.',style:{}}]; }
  }

  // 렌더링
  function render(){
    editorArea.innerHTML='';
    const page=document.createElement('div');
    page.style.cssText='background:#fff;width:210mm;min-height:297mm;padding:25mm 30mm;box-shadow:0 2px 8px rgba(0,0,0,.2);box-sizing:border-box;position:relative';

    _paragraphs.forEach((para,idx)=>{
      const p=document.createElement('p');
      p.dataset.idx=idx;
      p.contentEditable='true';
      p.style.cssText='margin:0 0 6px 0;padding:2px 4px;min-height:1.4em;line-height:1.8;border-radius:2px;outline:none;'
        +(para.style.heading?'font-size:16px;font-weight:700;':'font-size:'+(para.style.fontSize||10.5)+'pt;')
        +(para.style.bold?'font-weight:700;':'');
      p.textContent=para.text;
      p.oninput=()=>{ _paragraphs[idx].text=p.textContent; _modified=true; updateCounts(); };
      p.onfocus=()=>{ _cursorPara=idx; };
      p.style.transition='background .15s';
      p.onmouseenter=()=>p.style.background='rgba(0,120,200,.04)';
      p.onmouseleave=()=>p.style.background='';
      page.appendChild(p);
    });
    editorArea.appendChild(page);
    updateCounts();
  }

  // API
  const api={
    async loadFile(buffer, name){
      _fileName=name||''; _modified=false;
      const fnEl=document.getElementById('rhwp_filename'); if(fnEl) fnEl.textContent=name||'';
      setStatus('파일 분석 중...');
      const ext=(name||'').split('.').pop().toLowerCase();
      if(ext==='hwpx'||ext==='hwp'){
        _paragraphs=await parseHWPX(buffer);
      } else {
        _paragraphs=[{text:'지원하지 않는 형식입니다.',style:{}}];
      }
      render(); setStatus('완료 ('+_paragraphs.length+'문단)');
    },

    insertText(text){
      // 현재 포커스된 문단에 삽입
      const focused=editorArea.querySelector('p:focus');
      if(focused){
        const sel=window.getSelection();
        if(sel&&sel.rangeCount>0){
          const range=sel.getRangeAt(0); range.deleteContents();
          range.insertNode(document.createTextNode(text));
          range.collapse(false); sel.removeAllRanges(); sel.addRange(range);
          const idx=parseInt(focused.dataset.idx);
          if(!isNaN(idx)) _paragraphs[idx].text=focused.textContent;
          _modified=true; updateCounts(); return;
        }
      }
      // 포커스 없으면 새 문단 추가
      _paragraphs.push({text,style:{}}); render(); _modified=true;
    },

    async exportHwpx(){
      // 텍스트를 HWPX XML로 패키징
      if(!window.JSZip) await new Promise((res,rej)=>{ const s=document.createElement('script'); s.src='https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'; s.onload=res; s.onerror=rej; document.head.appendChild(s); });
      const zip=new JSZip();
      const xmlContent=`<?xml version="1.0" encoding="UTF-8"?>
<hword:HWPML xmlns:hword="urn:schemas-microsoft-com:office:hwp" version="5.0.3.0">
<hp:BODY xmlns:hp="urn:schemas-microsoft-com:office:hwp">
<hp:SECTION>
${_paragraphs.map(p=>`<hp:p><hp:run><hp:t>${p.text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</hp:t></hp:run></hp:p>`).join('\n')}
</hp:SECTION>
</hp:BODY>
</hword:HWPML>`;
      zip.file('Contents/section0.xml', xmlContent);
      zip.file('META-INF/container.xml','<?xml version="1.0"?><container><rootfiles><rootfile full-path="Contents/content.hpf"/></rootfiles></container>');
      const blob=await zip.generateAsync({type:'blob',mimeType:'application/hwp+zip'});
      return blob;
    },

    getContent(){ return _paragraphs.map(p=>p.text).join('\n'); },
    isModified(){ return _modified; },
    getParagraphs(){ return [..._paragraphs]; },
  };

  window._rhwpUndo=()=>{ render(); };
  return api;
}
