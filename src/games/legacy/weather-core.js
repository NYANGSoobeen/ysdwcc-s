// 프론트 js/weather.js 에서 골프 게임이 쓰는 부분(wxMs·WX_AWS_FRESH·wxCurrent)만 그대로 옮김. 프론트가 고치면 다시 복사.
const wxMs=t=>{ const x=String(t||''); if(x.length<10) return 0; return Date.UTC(+x.slice(0,4), +x.slice(4,6)-1, +x.slice(6,8), +x.slice(8,10), +(x.slice(10,12)||0))-9*3600e3; };
const WX_AWS_FRESH=30*60*1000;
// 지금 날씨 = 실시간 관측(AWS 매분자료, 몇 분 전) → 없으면 정시 관측(초단기실황) + 이번 시간 예보 (날씨 탭·원터치 골프 같이 씀)
function wxCurrent(d){
  d=d||{};
  const n=d.ncst||{}, ul=d.ultra||[];
  const a=d.aws&&Date.now()-wxMs(d.aws.tm)<WX_AWS_FRESH?d.aws:null;
  const k=new Date(Date.now()+9*3600e3), hourKey=k.getUTCFullYear()+String(k.getUTCMonth()+1).padStart(2,'0')+String(k.getUTCDate()).padStart(2,'0')+String(k.getUTCHours()).padStart(2,'0');
  const curIdx=ul.findIndex(x=>String(x.t).slice(0,10)===hourKey), cur=curIdx>=0?ul[curIdx]:(ul[0]||{});
  const raining=a?(+a.re===1||+a.rn15>0):null;
  const ncstPty=+n.PTY||0;
  const pty=a?(raining?(ncstPty||+cur.PTY||1):0):(ncstPty||+cur.PTY||0);
  const num=v=>v==null||v===''||isNaN(+v)?null:+v;
  const temp=a&&a.ta!=null?a.ta:num(n.T1H);
  const ws=a&&a.ws!=null?a.ws:num(n.WSD), wdeg=a&&a.wd!=null?a.wd:num(n.VEC), hm=a&&a.hm!=null?a.hm:num(n.REH);
  // 비 양(mm/시간 정도): 실시간 최근 1시간 → 15분×4 → 예보 → 정시 관측
  const fc=parseFloat(String(cur.RN1||'').replace(/[^0-9.]/g,''))||0;
  const mm=a?(+a.rn60>0?+a.rn60:+a.rn15>0?+a.rn15*4:0):(parseFloat(n.RN1)||fc);
  return {n, ul, a, cur, curIdx, raining, ncstPty, pty, temp, ws, wdeg, hm, mm};
}
