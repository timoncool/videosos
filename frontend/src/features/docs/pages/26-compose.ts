import type { DocPageContent } from '../docs-content'

const page = {
  order: 15.75,
  slug: 'motion',
  title: 'Use the Motion workspace',
  description:
    'Build, time, animate, parent, and reuse layered 2D compositions in the Motion workspace.',
  category: 'Creative Tools',
  related: ['motion-library', 'keyframes', 'shapes-masks', 'concepts'],
  sections: [
    {
      title: 'Open or create a Motion composition',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Motion keeps the media library, composition preview, layer timeline, properties, keyframes, graph, and Motion Library in one workspace.',
        },
        {
          kind: 'steps',
          items: [
            'Choose **Motion** in the workspace switcher, or press `Alt+3`.',
            'Pick an existing composition from the composition menu, or choose **New Comp**.',
            'To promote sequence clips, select them in Edit, open **Animation**, and choose **Create Motion Clip**.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Creating a Motion Clip preserves the selected clips and their animation inside the new composition. The new wrapper remains a regular clip in Edit.',
        },
      ],
    },
    {
      title: 'Add layers to the composition',
      blocks: [
        {
          kind: 'list',
          items: [
            'Drag video, audio, images, text, shapes, Lottie files, or another composition from the media library.',
            'Choose **Add Item** to create **Text**, **Solid Color**, **Gradient**, **Shape**, or **Null Object** layers.',
            'Solid Color and Gradient create full-frame shape layers that you can resize, style, mask, and animate.',
            'FreeCut blocks a composition from containing itself, including indirect circular nesting.',
          ],
        },
      ],
    },
    {
      title: 'Set the duration and active range',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The authored duration defines the composition. The ruler’s In and Out handles define the active render range inside that duration.',
        },
        {
          kind: 'steps',
          items: [
            'Drag the **In** and **Out** handles above the Motion ruler to mark the active range.',
            'Choose **Trim Comp to Active Region** to shorten the authored composition to that range.',
            'Choose **Zoom To Fit** to frame the authored composition without changing its duration.',
            'Edit **Comp Duration** in Properties, and select its unit to switch between frames and seconds.',
            'Read the matching **Timecode** value below the duration control.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Trimming keeps the In and Out controls available and fits the new range. Layers that extend beyond the authored duration remain visible in the dimmed overhang.',
        },
      ],
    },
    {
      title: 'Arrange and time layers',
      blocks: [
        {
          kind: 'list',
          items: [
            'Drag a layer span to move it in time. Selected layers move together in one undo step.',
            'Edit each layer’s **In** and **Out** fields, or drag its span edges to trim it.',
            'Use the layer controls to change visibility, lock, solo, blend mode, and stacking order.',
            'Drag the three-dot handle to reorder a layer or group. Child layers remain inside their current group.',
            'Select two or more layers and choose **Layer Group**. Group visibility, lock, solo, timing, and reordering apply to its children.',
            'Right-click a layer or group to rename, group, ungroup, duplicate, copy, paste, or delete it.',
          ],
        },
      ],
    },
    {
      title: 'Animate properties and path vertices',
      blocks: [
        {
          kind: 'list',
          items: [
            'Expand a layer to reveal nested property groups, value controls, auto-key, navigation, and keyframe diamonds.',
            'Set the property filter to **Animated properties** when you only need rows that contain keys.',
            'Select a property diamond to add or remove a key at the shared playhead.',
            'Select two neighboring keys to edit their segment easing.',
            'Select a property curve icon to replace its dope-sheet lane with an inline value graph.',
            'Open the Position group menu and choose **Separate Position dimensions** to edit X and Y independently.',
          ],
        },
        {
          kind: 'paragraph',
          text: 'Path shapes expose vertex lanes in Motion. Select path points in the preview, then switch between **Selected vertices** and **All vertices** above the property rows.',
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Once Path Geometry has keyframes, you cannot add, remove, reorder, or change the first path vertex. Remove those keys before changing the path topology.',
        },
      ],
    },
    {
      title: 'Parent layers with a Null Object',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Choose **Add Item > Null Object**. A Null Object controls transforms but does not render.',
            'Choose a parent from the **Parent** menu, or drag the Parent pick whip onto another layer.',
            'Release normally to preserve the child’s canvas pose.',
            'Hold **Shift** while releasing to snap the child position to the parent.',
            'Hold **Alt/Option** while releasing to use the child’s authored local pose.',
            'Ctrl-click or Command-click the child pick whip to detach it while preserving its current pose.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Valid parent targets highlight while you drag. Motion rejects self-parenting, descendant targets, and links that would create a cycle.',
        },
      ],
    },
    {
      title: 'Link properties or write an expression',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Parenting creates a layer hierarchy. A **Property Link** makes one property follow another without changing that hierarchy.',
        },
        {
          kind: 'list',
          items: [
            'Drag a property pick whip to a compatible row in Motion, the dope sheet, or the graph.',
            'Link scalar values to scalar values. Position, Scale, and Anchor link as complete two-dimensional values.',
            'Select the braces button to add a sandboxed expression without deleting the property’s keyframes.',
            'Use the expression pick whip to insert a `prop("layer-id", "property")` reference at the text cursor.',
            'Use `value`, `preValue`, `frame`, `time`, scalar or `[x, y]` values, arithmetic, and the supported math functions.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'FreeCut evaluates keyframes first, then Property Link, then the expression. Preview and export use the same order.',
        },
      ],
    },
    {
      title: 'Expose controls for reused compositions',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Open **Published controls** inside the source composition.',
            'Publish the text or colors that an editor should change on placed instances.',
            'Place the composition in a regular sequence and select that instance.',
            'Edit its published values in Properties without changing the source composition.',
            'Reset one override or use **Reset all overrides** to restore the source values.',
          ],
        },
      ],
    },
    {
      title: 'Use the composition in Edit',
      blocks: [
        {
          kind: 'paragraph',
          text: 'A Motion composition remains a reusable composition asset. Place it in a sequence, then move, trim, animate, or apply effects to the instance like any other clip.',
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Internal layer animation and whole-clip animation remain independent. A title can animate internally while its placed instance moves or fades in Edit.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
