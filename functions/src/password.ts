// 비밀번호 규칙. 앱(src/password.ts)과 서버(functions/src/password.ts)가 같은 파일을 쓴다.
// 고칠 때는 두 파일을 똑같이 고친다 (tests/password.test.mjs가 같은지 확인한다).

const MIN_LENGTH = 8
const RUN = 4 // 이만큼 이어지면 막는다: 1234, abcd, qwer, 4321, aaaa
const SEQUENCES = ['0123456789', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm']

function hasRun(value: string) {
  const v = value.toLowerCase()
  for (let i = 0; i + RUN <= v.length; i++) {
    const part = v.slice(i, i + RUN)
    if (new Set(part).size === 1) return true
    const reversed = [...part].reverse().join('')
    if (SEQUENCES.some((s) => s.includes(part) || s.includes(reversed))) return true
  }
  return false
}

// 문제가 있으면 안내 문구를, 괜찮으면 null을 돌려준다.
export function passwordProblem(value: string, loginId = ''): string | null {
  if (value.length < MIN_LENGTH) return `비밀번호는 ${MIN_LENGTH}자 이상이어야 합니다.`
  if (value.length > 64) return '비밀번호가 너무 깁니다.'
  if (/\s/.test(value)) return '비밀번호에 띄어쓰기는 쓸 수 없습니다.'
  if (!/[a-zA-Z]/.test(value) || !/[0-9]/.test(value)) return '영문과 숫자를 섞어 주세요.'
  if (hasRun(value)) return '1234, abcd, qwer, aaaa처럼 이어지거나 반복되는 글자는 쓸 수 없습니다.'
  const id = loginId.split('@')[0].toLowerCase()
  if (id.length >= 3 && value.toLowerCase().includes(id)) return '비밀번호에 아이디를 넣을 수 없습니다.'
  return null
}

export const PASSWORD_HINT = `${MIN_LENGTH}자 이상, 영문+숫자. 1234·abcd·qwer처럼 이어지는 글자는 안 됩니다.`
