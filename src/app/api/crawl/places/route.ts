import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// missa.cbck.or.kr 에서 피정지 크롤링
export async function GET() {
  try {
    const res = await fetch('https://missa.cbck.or.kr/Retreat', {
      headers: { 'Accept-Charset': 'utf-8' }
    })
    const html = await res.text()

    const places = parsePlaces(html)

    // 추가: name+diocese 기준 중복 제거
    const unique = Array.from(
      new Map(places.map(p => [`${p.name}_${p.diocese}`, p])).values()
    )

    // upsert (이름+교구 같으면 덮어쓰기)
    const { error } = await supabaseAdmin
    .from('retreat_places')
    .upsert(unique, {
      onConflict: 'name,diocese',
      ignoreDuplicates: false
    })

    if (error) throw error

    return NextResponse.json({
      success: true,
      count: places.length
    })

  } catch (err) {
    console.error(JSON.stringify(err))
    return NextResponse.json({ success: false, error: JSON.stringify(err) }, { status: 500 })
  }
}

function parsePlaces(html: string) {
  const places: {
    name: string
    diocese: string
    order_congregation: string
    address: string
    phone: string
    website: string
  }[] = []

  // 교구 위치 추출
  const diocesePattern = /class="rt01pagitem">([^<]+)<\/div>/g
  const dioceses: { index: number; name: string }[] = []
  let dm
  while ((dm = diocesePattern.exec(html)) !== null) {
    dioceses.push({ index: dm.index, name: dm[1].trim() })
  }

  // bs-callout 시작점 찾기
  const starts: number[] = []
  let searchFrom = 0
  const marker = 'class="bs-callout"'
  while (true) {
    const idx = html.indexOf(marker, searchFrom)
    if (idx === -1) break
    starts.push(idx)
    searchFrom = idx + 1
  }

  for (let i = 0; i < starts.length; i++) {
    // 다음 bs-callout 시작 전까지 잘라냄
    const block = html.slice(starts[i], starts[i + 1] ?? html.length)
    const blockIndex = starts[i]

    // 교구
    const diocese = dioceses
      .filter(d => d.index < blockIndex)
      .at(-1)?.name ?? ''

    // 수도회
    const congMatch = block.match(/<span>([^<]+)<\/span>/)
    const congregation = congMatch ? congMatch[1].trim() : ''

    // 시설명
    const nameMatch = block.match(/<h4[^>]*>([^<]+)<\/h4>/)
    if (!nameMatch) continue
    const name = nameMatch[1].trim()

    // p태그 파싱
    const pMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/)
    if (!pMatch) continue

    const parts = pMatch[1]
      .split(/<br\s*\/?>/i)
      .map(s => s.replace(/<[^>]+>/g, '').trim())
      .filter(Boolean)

    const address = parts[0] ?? ''
    const phone = parts[1]?.replace('☎', '').trim() ?? ''
    const website = parts[2] ?? ''

    places.push({
      name,
      diocese,
      order_congregation: congregation,
      address,
      phone,
      website
    })
  }

  return places
}