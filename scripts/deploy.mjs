// 전체 배포 (npm run release의 마지막 단계).
// 함수가 많아 한꺼번에 올리면 Google 쪽 "분당 요청 수 제한"에 걸려 몇 개만 실패하는 일이 있다.
// 그래서 실패하면 1분 쉬었다가 다시 배포한다 (이미 올라간 함수는 바뀐 게 없어 건너뛴다). 최대 3번.
import { spawnSync } from 'node:child_process'

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
    console.log('\n✅ 배포 완료')
    process.exit(0)
  }
  if (i < TRIES) {
    console.log(`\n⚠ 일부가 실패했습니다. ${WAIT_SECONDS}초 뒤 실패한 것만 다시 올립니다…`)
    await new Promise((r) => setTimeout(r, WAIT_SECONDS * 1000))
  }
}
console.log('\n❌ 배포가 끝까지 실패했습니다. 위의 Error 줄과 firebase-debug.log 마지막 부분을 Claude에게 보내 주세요.')
process.exit(1)
