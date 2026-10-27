// 전체 배포 (npm run release의 마지막 단계).
// 함수가 많아 한꺼번에 올리면 Google 쪽 "분당 요청 수 제한"에 걸려 몇 개만 실패하는 일이 있다.
// 그래서 실패하면 1분 쉬었다가 다시 배포한다 (이미 올라간 함수는 바뀐 게 없어 건너뛴다). 최대 3번.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const TRIES = 3
const WAIT_SECONDS = 60

// 다른 프로젝트(예: 프론트 앱)가 선택된 Cloud Shell에서도 이 앱 프로젝트로만 배포한다.
const env = { ...process.env }
delete env.GOOGLE_CLOUD_QUOTA_PROJECT

for (let i = 1; i <= TRIES; i++) {
  console.log(`\n▶ 배포 ${i}/${TRIES}번째 시도`)
  const { status } = spawnSync('npx', ['firebase', 'deploy', '--project', 'ysdwcc-s'], {
    stdio: 'inherit',
    shell: true,
    env,
  })
  if (status === 0) {
    await fixCallableAccess()
    console.log('\n✅ 배포 완료')
    process.exit(0)
  }
  if (i < TRIES) {
    console.log(`\n⚠ 일부가 실패했습니다. ${WAIT_SECONDS}초 뒤 실패한 것만 다시 올립니다…`)
    await new Promise((r) => setTimeout(r, WAIT_SECONDS * 1000))
  }
}
await fixCallableAccess()
console.log('\n❌ 배포가 끝까지 실패했습니다. 위의 Error 줄과 firebase-debug.log 마지막 부분을 Claude에게 보내 주세요.')
process.exit(1)

// 앱에서 부르는 함수(onCall)는 처음 만들 때만 "누구나 호출 가능"이 붙고, 그때 실패하면 계속 403(앱에서는 CORS 오류)이 난다.
// 배포 뒤 함수마다 밖에서 한 번 두드려 보고, 403이면 gcloud로 권한을 붙인다 (gcloud가 없으면 명령을 알려 준다).
async function fixCallableAccess() {
  const src = readFileSync(new URL('../functions/src/index.ts', import.meta.url), 'utf8')
  const names = [...src.matchAll(/export const (\w+) = onCall\(/g)].map((m) => m[1])
  const blocked = []
  for (const name of names) {
    try {
      const res = await fetch(`https://us-west1-ysdwcc-s.cloudfunctions.net/${name}`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://ysdwcc-s.web.app', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization' },
      })
      if (res.status === 403) blocked.push(name)
    } catch {
      // 인터넷 문제면 건너뛴다.
    }
  }
  if (blocked.length === 0) return console.log('\n✔ 앱에서 부르는 함수 모두 열려 있음')
  console.log(`\n🔧 호출이 막힌 함수 ${blocked.length}개: ${blocked.join(', ')} → 누구나 호출 가능으로 바꿉니다`)
  const failed = []
  for (const name of blocked) {
    const cmd = `gcloud run services add-iam-policy-binding ${name.toLowerCase()} --region=us-west1 --project=ysdwcc-s --member=allUsers --role=roles/run.invoker --quiet`
    const { status } = spawnSync(cmd, { stdio: 'inherit', shell: true, env })
    if (status !== 0) failed.push(cmd)
  }
  if (failed.length) {
    console.log('\n⚠ 아래 명령을 Google Cloud Shell에서 실행해 주세요 (gcloud가 없거나 권한 부족):')
    for (const cmd of failed) console.log(cmd)
  }
}
