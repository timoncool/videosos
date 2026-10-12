import type { DocPageContent } from '../docs-content'

const page = {
  order: 2,
  slug: 'workspaces',
  title: 'Workspaces and Storage',
  description:
    'How the workspace folder works, where files live, permissions, and cache maintenance.',
  category: 'Start',
  related: ['concepts', 'projects', 'troubleshooting'],
  sections: [
    {
      title: 'The workspace model',
      blocks: [
        {
          kind: 'list',
          items: [
            'The **workspace** is the folder VideoSOS keeps its projects in: `data\\workspace` beside the program, or `%LOCALAPPDATA%\\VideoSOS\\data\\workspace` when the program folder is read-only.',
            'Everything VideoSOS generates lives there: project files, media metadata, thumbnails, waveforms, transcripts, scene data, AI assets, caches, and exports.',
            'Imported source media is not copied into the workspace — VideoSOS records a link to each file where it already sits on disk.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Because the workspace is a real folder, you can back it up, sync it, or move it like any other directory.',
        },
      ],
    },
    {
      title: 'Generations',
      blocks: [
        {
          kind: 'list',
          items: [
            'Every generation is saved in `data\\generations`, one folder per job, before it is imported into a project.',
            'The history of generations, with their settings and prices, is kept in `data\\videosos.db`.',
            'Provider keys are kept in `secrets` beside the program, never in a project.',
          ],
        },
      ],
    },
    {
      title: 'Missing media',
      blocks: [
        {
          kind: 'list',
          items: [
            'Missing Media means VideoSOS cannot currently read one or more linked source files.',
                        'Use **Locate** or **Locate Folder** when a file or its folder was moved.',
            'Use **Browse Another Folder** to point VideoSOS at a new copy of the media.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Use **Work Offline** only when you plan to relink the files later; clips stay as broken references until then.',
        },
      ],
    },
    {
      title: 'Moving projects and clearing caches',
      blocks: [
        {
          kind: 'list',
          items: [
            'Use **Export Project** to package a project and its media into a portable bundle another workspace can import.',
            'Project cache actions clear regenerated data such as waveforms, filmstrips, GIF frames, and decoded audio.',
            'Storage settings also let you regenerate thumbnails, generate missing proxies, and delete proxies.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Clearing caches never deletes your source media; VideoSOS regenerates previews when the project needs them.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
