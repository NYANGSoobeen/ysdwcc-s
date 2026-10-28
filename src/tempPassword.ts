// 관리자가 새 계정·비밀번호 초기화 때 쓰는 임시 비밀번호 (11번).
// 헷갈리는 글자(0/o/O, 1/l/i/I)는 빼고, 영문 소문자 6 + 숫자 2 = 8자. 처음 로그인하면 본인이 새로 정한다.
const LETTERS = 'abcdefghjkmnpqrstuvwxyz'
const DIGITS = '23456789'

function pick(chars: string) {
  const n = new Uint32Array(1)
  crypto.getRandomValues(n)
  return chars[n[0] % chars.length]
}

export function makeTempPassword() {
  const out = [...Array.from({ length: 6 }, () => pick(LETTERS)), pick(DIGITS), pick(DIGITS)]
  // 숫자 위치도 섞는다
  for (let i = out.length - 1; i > 0; i--) {
    const j = new Uint32Array(1)
    crypto.getRandomValues(j)
    const k = j[0] % (i + 1)
    ;[out[i], out[k]] = [out[k], out[i]]
  }
  return out.join('')
}
