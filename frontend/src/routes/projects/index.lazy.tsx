import { createLazyFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState, useRef } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { createLogger } from '@/shared/logging/logger'

const logger = createLogger('ProjectsIndex')
import { Button } from '@/components/ui/button'
import { ArrowRight, Bot, Clapperboard, File, FolderOpen, KeyRound, Plus, Sparkles, Upload, Film } from 'lucide-react'
import { ProjectList } from '@/features/projects/components/project-list'
import { EditProjectForm } from '@/features/projects/components/project-form'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { useProjectActions } from '@/features/projects/hooks/use-project-actions'
import {
  useProjects,
  useProjectsLoading,
  useProjectsError,
} from '@/features/projects/hooks/use-project-selectors'
import type { Project } from '@/types/project'
import type { ProjectFormData } from '@/features/projects/utils/validation'
import type { ImportProgress } from '@/features/project-bundle/types/bundle'
import { BUNDLE_EXTENSION } from '@/features/project-bundle/types/bundle'
import { LegacyMigrationBanner } from '@/features/projects/components/legacy-migration-banner'
import { LegacyMigrationErrors } from '@/features/projects/components/legacy-migration-errors'
import { TrashSection } from '@/features/projects/components/trash-section'
import { WorkspaceIndicator } from '@/features/workspace-gate'

/** What VideoSOS does, as Dub Studio's start screen lists its modes. */
const START_FEATURES = [
  { key: 'generate', icon: Sparkles },
  { key: 'edit', icon: Film },
  { key: 'agent', icon: Bot },
  { key: 'yours', icon: KeyRound },
] as const

export const Route = createLazyFileRoute('/projects/')({
  component: ProjectsIndex,
})

function ProjectsIndex() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Import state - two-step flow
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null)
  const [projectNameFromFile, setProjectNameFromFile] = useState<string | null>(null)
  const [destinationDir, setDestinationDir] = useState<FileSystemDirectoryHandle | null>(null)
  const [destinationName, setDestinationName] = useState<string | null>(null)
  const [useProjectsFolder, setUseProjectsFolder] = useState(true) // Create FreeCutProjects subfolder
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [isImporting, setIsImporting] = useState(false)

  const PROJECTS_FOLDER_NAME = 'FreeCutProjects'

  // Extract project name from bundle filename
  // Handles both "myproject.freecut.zip" and browser-renamed "myproject.freecut (1).zip"
  const extractProjectName = (fileName: string): string => {
    // Remove .zip extension first
    let name = fileName.replace(/\.zip$/i, '')
    // Remove browser duplicate suffix like " (1)", " (2)", etc.
    name = name.replace(/\s*\(\d+\)$/, '')
    // Remove .freecut suffix
    name = name.replace(/\.freecut$/i, '')
    return name
  }

  // Check if file is a valid bundle (handles browser-renamed files like "project.freecut (1).zip")
  const isValidBundleFile = (fileName: string): boolean => {
    // Match: anything.freecut.zip or anything.freecut (N).zip
    return /\.freecut(\s*\(\d+\))?\.zip$/i.test(fileName)
  }

  const isLoading = useProjectsLoading()
  const projects = useProjects()
  const error = useProjectsError()
  const { loadProjects, updateProject } = useProjectActions()

  // Only show the full-page spinner for the genuine initial load — mutations
  // (delete/duplicate/update) should never blank the populated list.
  const showInitialLoadingSpinner = isLoading && projects.length === 0

  // Load projects on mount
  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  // Handle import file selection
  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  // Step 1: File selected - show destination selection dialog
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    // Reset file input for next selection
    event.target.value = ''

    // Validate file extension (handles browser-renamed files like "project.freecut (1).zip")
    if (!isValidBundleFile(file.name)) {
      setImportError(t('projects.import.invalidFile', { extension: BUNDLE_EXTENSION }))
      setImportDialogOpen(true)
      return
    }

    // Store file and extract project name, then show destination selection dialog
    setPendingImportFile(file)
    setProjectNameFromFile(extractProjectName(file.name))
    setDestinationDir(null)
    setDestinationName(null)
    setImportError(null)
    setImportProgress(null)
    setIsImporting(false)
    setImportDialogOpen(true)
  }

  // Step 2: User clicks to select destination folder (fresh user gesture!)
  const handleSelectDestination = async () => {
    try {
      const dirHandle = await window.showDirectoryPicker({
        id: 'freecut-import',
        mode: 'readwrite',
        startIn: 'documents',
      })
      setDestinationDir(dirHandle)
      setDestinationName(dirHandle.name)
      setImportError(null)
    } catch (err) {
      // User cancelled - ignore
      if (err instanceof DOMException && err.name === 'AbortError') {
        return
      }
      // Handle "contains system files" or permission errors
      if (
        err instanceof DOMException &&
        (err.name === 'NotAllowedError' || err.name === 'SecurityError')
      ) {
        setImportError(t('projects.import.cannotSelectSystemFolders'))
        return
      }
      logger.error('Failed to select directory:', err)
      setImportError(t('projects.import.selectDestinationFailed'))
    }
  }

  // Step 3: User clicks "Start Import" - begin actual import
  const handleStartImport = async () => {
    if (!pendingImportFile || !destinationDir) return

    setIsImporting(true)
    setImportProgress({ percent: 0, stage: 'validating' })

    try {
      // If useProjectsFolder is enabled, create/get the FreeCutProjects subfolder first
      let finalDestination = destinationDir
      if (useProjectsFolder) {
        try {
          finalDestination = await destinationDir.getDirectoryHandle(PROJECTS_FOLDER_NAME, {
            create: true,
          })
        } catch (err) {
          logger.error('Failed to create FreeCutProjects folder:', err)
          throw new Error(t('projects.import.createFolderFailed', { folder: PROJECTS_FOLDER_NAME }))
        }
      }

      const { importProjectBundle } =
        await import('@/features/project-bundle/services/bundle-import-service')

      const result = await importProjectBundle(
        pendingImportFile,
        finalDestination,
        {},
        (progress) => {
          setImportProgress(progress)
        },
      )

      // Reload projects list
      await loadProjects()

      // Close dialog and navigate to the imported project
      handleCloseImportDialog()
      navigate({ to: '/editor/$projectId', params: { projectId: result.project.id } })
    } catch (err) {
      logger.error('Import failed:', err)
      setImportError(err instanceof Error ? err.message : t('projects.import.importFailed'))
      setImportProgress(null)
      setIsImporting(false)
    }
  }

  // Reset import dialog state
  const handleCloseImportDialog = () => {
    if (isImporting) return // Don't close while importing
    setImportDialogOpen(false)
    setPendingImportFile(null)
    setProjectNameFromFile(null)
    setDestinationDir(null)
    setDestinationName(null)
    setImportError(null)
    setImportProgress(null)
    setIsImporting(false)
  }

  // Compute full destination path for display
  const getFullDestinationPath = (): string => {
    if (!destinationName) return ''
    const parts = [destinationName]
    if (useProjectsFolder) parts.push(PROJECTS_FOLDER_NAME)
    if (projectNameFromFile) parts.push(projectNameFromFile)
    return parts.join('/')
  }

  // Format file size for display
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const handleEditProject = (project: Project) => {
    setEditingProject(project)
  }

  const handleEditSubmit = async (data: ProjectFormData) => {
    if (!editingProject) return

    setIsSubmitting(true)
    try {
      await updateProject(editingProject.id, data)
      setEditingProject(null)
    } catch (error) {
      logger.error('Failed to update project:', error)
      toast.error(t('projects.toasts.updateFailed'), { description: t('projects.tryAgain') })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <div className="min-h-full bg-background">
        {/* The studios' start screen (Dub Studio): what the program does on the left, the action on the right */}
        <section className="mx-auto grid max-w-[1200px] grid-cols-1 items-center gap-10 px-8 pb-4 pt-12 lg:grid-cols-[1.15fr_1fr]">
          <div>
            <div className="mono mb-4 flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-[var(--color-muted)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
              {t('start.eyebrow')}
            </div>
            <h1 className="text-[34px] font-bold leading-[1.1] tracking-tight">{t('start.title')}</h1>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-[var(--color-muted)]">{t('start.lead')}</p>
            <div className="mt-7 space-y-4">
              {START_FEATURES.map(({ icon: Icon, key }) => (
                <div key={key} className="flex items-start gap-3.5">
                  <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-accent)]">
                    <Icon size={18} strokeWidth={2} />
                  </div>
                  <div>
                    <div className="text-[15px] font-semibold leading-tight">{t(`start.features.${key}.title`)}</div>
                    <div className="mt-0.5 text-sm text-[var(--color-muted)]">{t(`start.features.${key}.text`)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="relative rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center">
            <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-accent)]">
              <Clapperboard size={26} />
            </div>
            <h2 className="text-[18px] font-semibold">{t('start.cardTitle')}</h2>
            <p className="mx-auto mt-1.5 max-w-sm text-sm text-[var(--color-muted)]">{t('start.cardText')}</p>
            <div className="mt-6 flex flex-col gap-2.5">
              <Button asChild size="lg" className="h-11 gap-2 text-[15px] font-semibold">
                <Link to="/projects/new">
                  <Plus className="h-4 w-4" />
                  {t('projects.newProject')}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button variant="outline" size="lg" className="h-11 gap-2" onClick={handleImportClick}>
                <Upload className="h-4 w-4" />
                {t('projects.importProject')}
              </Button>
            </div>
            <div className="mt-5 flex justify-center">
              <WorkspaceIndicator />
            </div>
            <input ref={fileInputRef} type="file" accept=".zip" onChange={handleFileSelect} className="hidden" />
          </div>
        </section>

        {/* Error state */}
        {error && (
          <div className="mx-auto max-w-[1200px] px-8 py-4">
            <div className="panel-bg border border-destructive/50 rounded-lg p-4 text-destructive">
              <p className="font-medium">{t('projects.errorLoading')}</p>
              <p className="text-sm mt-1">{error}</p>
            </div>
          </div>
        )}

        {/* Legacy IDB migration banner — appears only when old data is present and unmigrated */}
        <div className="mx-auto max-w-[1200px] space-y-3 px-8 pt-6">
          <LegacyMigrationBanner onMigrated={loadProjects} />
          {/* Retry banner — appears only when a previous migration left failed items behind */}
          <LegacyMigrationErrors onRetried={loadProjects} />
        </div>

        {/* Loading state */}
        {showInitialLoadingSpinner ? (
          <div className="mx-auto flex max-w-[1200px] items-center justify-center px-8 py-16">
            <div className="text-center">
              <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin mx-auto mb-4" />
              <p className="text-muted-foreground">{t('projects.loadingProjects')}</p>
            </div>
          </div>
        ) : (
          /* Projects List */
          <div className="mx-auto max-w-[1200px] px-8 py-8">
            <h2 className="mb-3 text-[11px] uppercase tracking-[0.14em] text-[var(--color-muted)]">{t('start.projects')}</h2>
            <ProjectList onEditProject={handleEditProject} onImportProject={handleImportClick} />
            <TrashSection />
          </div>
        )}
      </div>

      {/* Edit Project Dialog */}
      <Dialog open={!!editingProject} onOpenChange={(open) => !open && setEditingProject(null)}>
        <DialogContent className="max-w-[1200px] w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl">{t('projects.form.editTitle')}</DialogTitle>
            <DialogDescription>{t('projects.form.editSubtitle')}</DialogDescription>
          </DialogHeader>
          {editingProject && (
            <EditProjectForm
              onSubmit={handleEditSubmit}
              onCancel={() => setEditingProject(null)}
              defaultValues={{
                name: editingProject.name,
                description: editingProject.description,
                width: editingProject.metadata.width,
                height: editingProject.metadata.height,
                fps: editingProject.metadata.fps,
              }}
              isSubmitting={isSubmitting}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Import Project Dialog - Two Step Flow */}
      <Dialog
        open={importDialogOpen}
        onOpenChange={(open) => {
          if (!open) handleCloseImportDialog()
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {importError
                ? t('projects.import.importFailedTitle')
                : isImporting
                  ? t('projects.import.importingTitle')
                  : t('projects.import.importTitle')}
            </DialogTitle>
            {!importError && !isImporting && pendingImportFile && (
              <DialogDescription>{t('projects.import.selectWhereToExtract')}</DialogDescription>
            )}
            {!importError && isImporting && importProgress && (
              <DialogDescription>
                {importProgress.stage === 'validating' && t('projects.import.stageValidating')}
                {importProgress.stage === 'extracting' &&
                  (importProgress.currentFile
                    ? t('projects.import.stageExtractingFile', {
                        file: importProgress.currentFile,
                      })
                    : t('projects.import.stageExtracting'))}
                {importProgress.stage === 'importing_media' &&
                  (importProgress.currentFile
                    ? t('projects.import.stageImportingFile', { file: importProgress.currentFile })
                    : t('projects.import.stageImporting'))}
                {importProgress.stage === 'linking' && t('projects.import.stageLinking')}
                {importProgress.stage === 'complete' && t('projects.import.stageComplete')}
              </DialogDescription>
            )}
          </DialogHeader>

          {importError && !pendingImportFile ? (
            /* Fatal error state - no file */
            <div className="space-y-4">
              <p className="text-sm text-destructive">{importError}</p>
              <Button variant="outline" className="w-full" onClick={handleCloseImportDialog}>
                {t('common.close')}
              </Button>
            </div>
          ) : isImporting && importProgress ? (
            /* Importing state - show progress */
            <div className="space-y-4">
              <Progress value={importProgress.percent} className="h-2" />
              <p className="text-sm text-muted-foreground text-center">
                {Math.round(importProgress.percent)}%
              </p>
            </div>
          ) : pendingImportFile ? (
            /* Destination selection state */
            <div className="space-y-4">
              {/* File info */}
              <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
                <File className="w-8 h-8 text-muted-foreground flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm truncate">{pendingImportFile.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatFileSize(pendingImportFile.size)}
                  </p>
                </div>
              </div>

              {/* Destination selection */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{t('projects.import.destinationFolder')}</p>
                  {!destinationDir && (
                    <p className="text-xs text-muted-foreground">
                      {t('projects.import.useNewFolderIfNeeded')}
                    </p>
                  )}
                </div>
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2"
                  onClick={handleSelectDestination}
                >
                  <FolderOpen className="w-4 h-4" />
                  {destinationName ? (
                    <span className="truncate">{destinationName}</span>
                  ) : (
                    <span className="text-muted-foreground">
                      {t('projects.import.selectOrCreateFolder')}
                    </span>
                  )}
                </Button>

                {/* FreeCutProjects subfolder option */}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useProjectsFolder}
                    onChange={(e) => setUseProjectsFolder(e.target.checked)}
                    className="w-4 h-4 rounded border-border accent-primary"
                  />
                  <span className="text-sm">
                    <Trans
                      i18nKey="projects.import.createInSubfolder"
                      values={{ folder: PROJECTS_FOLDER_NAME }}
                      components={{
                        code: <code className="text-xs bg-muted px-1 py-0.5 rounded" />,
                      }}
                    />
                  </span>
                </label>

                {importError && <p className="text-xs text-destructive">{importError}</p>}
                {destinationDir && !importError && (
                  <div className="p-3 bg-muted/50 rounded-lg border border-border">
                    <p className="text-xs text-muted-foreground mb-1">
                      {t('projects.import.mediaWillBeSavedTo')}
                    </p>
                    <p className="text-sm font-semibold text-foreground break-all">
                      {getFullDestinationPath()}
                    </p>
                  </div>
                )}
              </div>

              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="outline" onClick={handleCloseImportDialog}>
                  {t('common.cancel')}
                </Button>
                <Button onClick={handleStartImport} disabled={!destinationDir}>
                  {t('projects.import.startImport')}
                </Button>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
