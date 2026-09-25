import { describe, expect, it } from 'vitest'
import { goalDescription, GOALS } from '@shared/presets'

describe('goals', () => {
  it('have wording for photos only, videos only, and both', () => {
    for (const g of GOALS) {
      expect(g.photos).not.toMatch(/video/i)
      expect(g.videos).not.toMatch(/photo/i)
      expect(goalDescription(g, { photos: true, videos: false })).toBe(g.photos)
      expect(goalDescription(g, { photos: false, videos: true })).toBe(g.videos)
      expect(goalDescription(g, { photos: true, videos: true })).toBe(g.description)
      expect(goalDescription(g, { photos: false, videos: false })).toBe(g.description)
    }
  })

  it('offer the default goal in Simple view', () => {
    expect(GOALS[0].simple).toBe(true)
    expect(GOALS.filter((g) => g.simple).length).toBeGreaterThanOrEqual(3)
  })
})
