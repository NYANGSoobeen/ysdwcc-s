// 비밀번호 규칙: 앱과 서버가 같은 파일을 쓰는지, 규칙이 맞게 동작하는지 확인한다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const { passwordProblem } = await import('../functions/lib/password.js')

test('앱(src)과 서버(functions)의 비밀번호 규칙 파일이 같다', () => {
  assert.equal(readFileSync('src/password.ts', 'utf8'), readFileSync('functions/src/password.ts', 'utf8'))
})

test('연속되거나 반복되는 글자, 짧은 비밀번호, 아이디가 들어간 비밀번호는 막는다', () => {
  for (const bad of ['pass1234', 'x9876abc', 'abcd2468', 'zyxw1357', 'qwer2468', 'asdf8642', 'vbnm1357x', 'aaaa1357', 'a1111bcz', 'Ab1', 'abcdefgh', '2345678x', 'kim24680x']) {
    assert.ok(passwordProblem(bad, 'kim@workphone.local'), `${bad}는 막혀야 함`)
  }
  for (const good of ['Busan7319k', 'Yangsan2468', 'gold3579tree', 'Sea2Sky8Run']) {
    assert.equal(passwordProblem(good, 'kim@workphone.local'), null, `${good}는 통과해야 함`)
  }
})
