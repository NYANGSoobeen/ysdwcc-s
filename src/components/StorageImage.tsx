import { useEffect, useState } from 'react'
import { photoUrl } from '../chat.ts'

type Props = { path: string; alt?: string; className?: string; onClick?: () => void; load?: () => Promise<string> }

export function StorageImage({ path, alt = '사진', className, onClick, load }: Props) {
  const [src, setSrc] = useState<string>()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    setSrc(undefined)
    setFailed(false)
    ;(load ? load() : photoUrl(path)).then(
      (url) => active && setSrc(url),
      () => active && setFailed(true),
    )
    return () => {
      active = false
    }
    // load는 path가 같으면 같은 사진을 가리킨다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  if (failed) return <div className={`${className ?? ''} photo-missing`}>삭제된 사진</div>
  if (!src) return <div className={`${className ?? ''} photo-loading`} />
  return <img src={src} alt={alt} className={className} onClick={onClick} loading="lazy" decoding="async" />
}
