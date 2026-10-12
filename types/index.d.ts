export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type Modele = 'Haiku' | 'Sonnet' | 'Opus' | 'Fable'

/** Le conseil rendu pour la dernière demande substantielle. */
export type Conseil = { modele: Modele; effort: Effort; raison: string }

/** Le réglage de la session, lu sur la première requête du dernier tour. */
export type Reglage = { modele: string; effort: string | null }

declare module 'claude-code' {
  interface PluginState {
    'conseil-modele': { conseil: Conseil | null; reglage: Reglage | null; enCours: boolean }
  }
}
