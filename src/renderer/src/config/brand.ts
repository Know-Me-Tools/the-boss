import iconDark from '@renderer/assets/brand/icon-dark.svg'
import iconLight from '@renderer/assets/brand/icon-light.svg'
import lockupDark from '@renderer/assets/brand/lockup-dark.svg'
import lockupLight from '@renderer/assets/brand/lockup-light.svg'
import wordmarkDark from '@renderer/assets/brand/wordmark-dark.svg'
import wordmarkLight from '@renderer/assets/brand/wordmark-light.svg'
import { useTheme } from '@renderer/context/ThemeProvider'
import { ThemeMode } from '@renderer/types'
import { BRAND_PRIMARY_DARK, BRAND_PRIMARY_LIGHT, LEGACY_DEFAULT_COLOR_PRIMARY } from '@shared/config/brandTheme'

export type BrandAssetKind = 'icon' | 'wordmark' | 'lockup'
export type ResolvedBrandTheme = ThemeMode.dark | ThemeMode.light

const brandAssets = {
  [ThemeMode.dark]: {
    icon: iconDark,
    wordmark: wordmarkDark,
    lockup: lockupDark
  },
  [ThemeMode.light]: {
    icon: iconLight,
    wordmark: wordmarkLight,
    lockup: lockupLight
  }
} as const

const defaultBrandColors = new Set(
  [LEGACY_DEFAULT_COLOR_PRIMARY, BRAND_PRIMARY_DARK, BRAND_PRIMARY_LIGHT].map((color) => color.toLowerCase())
)

export const AppIcon = iconLight

export const resolveBrandTheme = (theme: ThemeMode | string | null | undefined): ResolvedBrandTheme => {
  return theme === ThemeMode.light ? ThemeMode.light : ThemeMode.dark
}

export const getBrandAsset = (theme: ResolvedBrandTheme, kind: BrandAssetKind) => {
  return brandAssets[theme][kind]
}

export const resolveBrandPrimary = (theme: ResolvedBrandTheme, preferredColor?: string) => {
  if (!preferredColor || defaultBrandColors.has(preferredColor.toLowerCase())) {
    return theme === ThemeMode.light ? BRAND_PRIMARY_LIGHT : BRAND_PRIMARY_DARK
  }

  return preferredColor
}

export const useBrandAssets = () => {
  const { theme } = useTheme()
  const resolvedTheme = resolveBrandTheme(theme)

  return {
    theme: resolvedTheme,
    appIcon: AppIcon,
    icon: getBrandAsset(resolvedTheme, 'icon'),
    wordmark: getBrandAsset(resolvedTheme, 'wordmark'),
    lockup: getBrandAsset(resolvedTheme, 'lockup'),
    primary: resolveBrandPrimary(resolvedTheme)
  }
}
