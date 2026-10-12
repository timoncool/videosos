import { z } from 'zod'
import { i18n } from '@/i18n'
import {
  DEFAULT_PROJECT_FPS,
  DEFAULT_PROJECT_HEIGHT,
  DEFAULT_PROJECT_WIDTH,
} from '@/shared/projects/defaults'
import { isAllowedProjectFps } from './project-fps'

/**
 * Validation schema for project creation/update form
 */
export function createProjectFormSchema(t: (key: string) => string) {
  return z.object({
    name: z
      .string()
      .min(1, t('projects.validation.nameRequired'))
      .max(100, t('projects.validation.nameTooLong'))
      .refine((name) => name.trim().length > 0, {
        message: t('projects.validation.nameWhitespace'),
      }),

    description: z
      .string()
      .max(500, t('projects.validation.descriptionTooLong'))
      .optional()
      .or(z.literal('')),

    width: z
      .number()
      .int(t('projects.validation.widthInteger'))
      .min(320, t('projects.validation.widthMin'))
      .max(7680, t('projects.validation.widthMax')),

    height: z
      .number()
      .int(t('projects.validation.heightInteger'))
      .min(240, t('projects.validation.heightMin'))
      .max(4320, t('projects.validation.heightMax')),

    fps: z
      .number()
      .int(t('projects.validation.fpsInteger'))
      .min(1, t('projects.validation.fpsMin'))
      .max(240, t('projects.validation.fpsMax'))
      .refine((fps) => isAllowedProjectFps(fps), {
        message: t('projects.validation.fpsUnsupported'),
      }),

    backgroundColor: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/, t('projects.validation.invalidHexColor'))
      .optional(),
  })
}

const projectFormSchema = createProjectFormSchema(i18n.t.bind(i18n))

/**
 * Type inferred from the schema
 */
export type ProjectFormData = z.infer<typeof projectFormSchema>

/**
 * Project template interface for preset configurations
 */
export interface ProjectTemplate {
  id: string
  platform: string
  name: string
  namePrefix: string
  width: number
  height: number
  fps: number
}

/**
 * Project templates for common platforms
 * 6 preset configurations with collision-free naming
 */
export const PROJECT_TEMPLATES: readonly ProjectTemplate[] = [
  {
    id: 'youtube-1080p',
    platform: 'YouTube',
    name: 'YouTube 1080p',
    namePrefix: 'YouTube',
    width: 1920,
    height: 1080,
    fps: 30,
  },
  {
    id: 'vertical-9-16',
    platform: 'Vertical',
    name: 'Shorts / TikTok / Reels',
    namePrefix: 'Vertical',
    width: 1080,
    height: 1920,
    fps: 30,
  },
  {
    id: 'instagram-square',
    platform: 'Instagram',
    name: 'Instagram Square',
    namePrefix: 'Instagram Square',
    width: 1080,
    height: 1080,
    fps: 30,
  },
  {
    id: 'instagram-portrait',
    platform: 'Instagram',
    name: 'Instagram Portrait',
    namePrefix: 'Instagram Portrait',
    width: 1080,
    height: 1350,
    fps: 30,
  },
  {
    id: 'twitter-x',
    platform: 'Twitter/X',
    name: 'Twitter/X',
    namePrefix: 'Twitter/X',
    width: 1200,
    height: 675,
    fps: 30,
  },
  {
    id: 'linkedin',
    platform: 'LinkedIn',
    name: 'LinkedIn',
    namePrefix: 'LinkedIn',
    width: 1200,
    height: 627,
    fps: 30,
  },
] as const

/**
 * Default form values
 */
export const DEFAULT_PROJECT_VALUES: ProjectFormData = {
  name: '',
  description: '',
  width: DEFAULT_PROJECT_WIDTH,
  height: DEFAULT_PROJECT_HEIGHT,
  fps: DEFAULT_PROJECT_FPS,
}

/**
 * Get resolution aspect ratio
 */
export function getAspectRatio(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const divisor = gcd(width, height)

  const ratioWidth = width / divisor
  const ratioHeight = height / divisor

  // Common aspect ratios
  if (ratioWidth === 16 && ratioHeight === 9) return '16:9'
  if (ratioWidth === 9 && ratioHeight === 16) return '9:16'
  if (ratioWidth === 4 && ratioHeight === 3) return '4:3'
  if (ratioWidth === 3 && ratioHeight === 4) return '3:4'
  if (ratioWidth === 21 && ratioHeight === 9) return '21:9'
  if (ratioWidth === 1 && ratioHeight === 1) return '1:1'
  if (ratioWidth === 2 && ratioHeight === 3) return '2:3'
  if (ratioWidth === 3 && ratioHeight === 2) return '3:2'
  if (ratioWidth === 4 && ratioHeight === 5) return '4:5'
  if (ratioWidth === 5 && ratioHeight === 4) return '5:4'

  return `${ratioWidth}:${ratioHeight}`
}
