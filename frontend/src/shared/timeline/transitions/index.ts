// Auto-register built-in transitions on module load
import { registerBuiltinTransitions } from './register-builtins'

registerBuiltinTransitions()

export { transitionRegistry } from './registry'
