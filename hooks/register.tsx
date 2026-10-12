import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Conseil, Effort, Reglage } from '../types'

const conseil = atom({ plugin: 'conseil-modele', key: 'conseil' } as const, null)
const reglage = atom({ plugin: 'conseil-modele', key: 'reglage' } as const, null)
const enCours = atom({ plugin: 'conseil-modele', key: 'enCours' } as const, false)

const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

// La règle sur les modèles se lit, quand le réglage `fichierRegles` en nomme un, dans la section
// « ## Modèle » de ce fichier Markdown, relue à chaque conseil : on garde sa règle là où on
// l'écrit déjà (un CLAUDE.md, par exemple). Sans fichier, ou s'il est illisible, la règle par défaut.
const REGLE_PAR_DEFAUT = `Opus est le modèle de travail, pour réfléchir comme pour exécuter. Fable seulement pour un problème difficile, annoncé comme tel au départ. Texte public et choix visuels : jamais plus faible qu'Opus. Changer de modèle en cours de session réécrit toute la conversation : descendre de Fable à Opus se rembourse en un ou deux prompts, monter vers Fable reste une dépense. L'effort se change sans rien réécrire.`

const GRILLE_EFFORT = `- low : un geste mécanique ou une question dont la réponse se lit : commit, renommer, lire une valeur, reformater, lancer une commande connue.
- medium : une tâche claire qui suit une recette connue : éditer un fichier selon une consigne précise, jouer une skill rodée, petit script, mise à jour de données.
- high : du jugement ou un texte qui sort : copy public, email client ou de prospection, plan, recommandation, arbitrage, code sur plusieurs fichiers, bug dont la cause est inconnue.
- xhigh : un raisonnement long où tout se tient : architecture, audit large, business plan, chantier de plusieurs heures, bug qui a résisté à une première tentative.
- max : seulement quand l'exactitude prime sur le coût et que xhigh n'a pas suffi : décision irréversible, contrat, calcul qui engage de l'argent.`

// « oui », « vas-y », « continue » : la tâche ne change pas, le conseil en place reste.
const RELANCE_COURTE = 25

// Les prompts qu'une personne tape : au terminal, par Remote Control, dans l'app desktop (hôte SDK,
// que le moteur tamponne `sdk` ou ne sait pas classer). Une tâche planifiée, une notification ou une
// autre session n'ont pas de conseil à recevoir.
const ORIGINES_HUMAINES = new Set(['composer', 'bridge', 'sdk', 'unclassified'])

function systeme(regleModeles: string): string {
  return `Tu conseilles une personne qui travaille dans Claude Code sur le modèle et le niveau d'effort à régler pour la tâche en cours. Tu lis la fin de la conversation et sa nouvelle demande, puis tu réponds par un seul objet JSON, sans rien autour :
{"modele": "Opus" ou "Fable", "effort": "low" | "medium" | "high" | "xhigh" | "max", "raison": "une phrase de 15 mots au plus, en français, qui nomme la tâche et ce qui décide"}

Sa règle sur les modèles, à appliquer telle quelle (tu ne conseilles jamais Sonnet ni Haiku) :
${regleModeles}

Prix par million de tokens, entrée puis sortie : Opus 5.5 à 4 et 20 $, Fable 5.1 à 10 et 50 $. Fable coûte 2,5 fois Opus.

L'effort règle combien le modèle réfléchit et vérifie avant d'agir ; un cran plus haut, ce sont plus de tokens de sortie. La grille :
${GRILLE_EFFORT}

Juge la tâche, pas la longueur du message : une ligne peut demander un audit entier. Tant que la tâche ne change pas, garde le même conseil. Entre deux niveaux, prends le plus bas : la personne remonte d'un cran si le résultat déçoit. N'écris jamais de tiret cadratin.`
}

export function nomModele(id: string): string {
  const bas = id.toLowerCase()
  for (const nom of ['fable', 'mythos', 'opus', 'sonnet', 'haiku']) {
    if (bas.includes(nom)) return nom.charAt(0).toUpperCase() + nom.slice(1)
  }
  return id
}

export function lireReponse(texte: string): Conseil | null {
  const bloc = texte.match(/\{[\s\S]*\}/)
  if (bloc === null) return null
  try {
    const o = JSON.parse(bloc[0]) as Record<string, unknown>
    const modele = o.modele === 'Opus' || o.modele === 'Fable' ? o.modele : null
    const effort = EFFORTS.find(niveau => niveau === o.effort)
    if (modele === null || effort === undefined) return null
    const raison = typeof o.raison === 'string' ? o.raison.replace(/\s*\u2014\s*/g, ', ').trim() : ''
    return { modele, effort, raison }
  } catch {
    return null
  }
}

// Du moins cher au plus cher, pour dire si le conseil fait monter ou descendre.
const RANG: Record<string, number> = { Haiku: 0, Sonnet: 1, Opus: 2, Fable: 3, Mythos: 3 }

/**
 * Ce que le conseil demande de bouger par rapport au réglage : le modèle (garder, monter vers plus
 * cher, descendre vers moins cher) et l'effort en crans signés (positif : monter).
 */
export type Ecart = { modele: 'garder' | 'monter' | 'descendre'; effort: number }

export function ecartDe(c: Conseil, r: Reglage | null): Ecart | null {
  if (r === null) return null
  const actuel = RANG[nomModele(r.modele)]
  const vise = RANG[c.modele] ?? 0
  const modele = actuel === undefined || actuel === vise ? 'garder' : actuel < vise ? 'monter' : 'descendre'
  const i = EFFORTS.indexOf(r.effort as Effort)
  return { modele, effort: i < 0 ? 0 : EFFORTS.indexOf(c.effort) - i }
}

/** Les gestes à faire, dans l'ordre : le modèle d'abord, puis l'effort. */
export function gestesDe(c: Conseil, e: Ecart): string[] {
  const gestes: string[] = []
  if (e.modele === 'descendre') {
    gestes.push(`Passe en ${c.modele} maintenant : la relecture de la conversation se rembourse dès le prompt suivant.`)
  } else if (e.modele === 'monter' && c.modele === 'Fable') {
    gestes.push('Passe en Fable seulement si la difficulté est réelle : il relit toute la conversation à son prix, puis coûte 2,5 fois Opus par prompt.')
  } else if (e.modele === 'monter') {
    gestes.push(`Passe en ${c.modele} : ta règle met tout le travail sur Opus.`)
  }
  if (e.effort > 0) gestes.push(`Monte l'effort à ${c.effort} : changer d'effort ne fait pas relire la conversation.`)
  if (e.effort < 0) gestes.push(`Baisse l'effort à ${c.effort} : changer d'effort ne fait pas relire la conversation.`)
  return gestes
}

async function regleModeles($: EngineInterface, fichier: string): Promise<string> {
  if (fichier === '') return REGLE_PAR_DEFAUT
  try {
    const texte = await $.fs.read(fichier)
    const debut = texte.indexOf('## Modèle')
    if (debut < 0) return REGLE_PAR_DEFAUT
    const fin = texte.indexOf('\n## ', debut + 1)
    return texte.slice(debut, fin < 0 ? undefined : fin).trim()
  } catch {
    $.ui.log(`conseil-modele : ${fichier} illisible, règle par défaut`, { to: 'debug' })
    return REGLE_PAR_DEFAUT
  }
}

async function conseiller($: EngineInterface, demande: string, fichier: string): Promise<void> {
  await update($, enCours, () => true)
  try {
    const messages = (await $.session.messages()).filter(m => m.text.trim() !== '')
    const dernier = messages.at(-1)
    if (dernier?.role === 'user' && dernier.text.trim() === demande.trim()) messages.pop()
    const fin = messages
      .slice(-6)
      .map(m => `${m.role === 'user' ? 'Utilisateur' : 'Claude'} : ${m.text.slice(0, 300)}`)
      .join('\n')
    const actuel = await read($, reglage)
    const tour = await $.session.turns()
    const prompt = [
      `Réglage actuel : ${actuel === null ? 'inconnu' : `${nomModele(actuel.modele)}, effort ${actuel.effort ?? 'inconnu'}`}. Tours déjà joués : ${tour}.`,
      fin === '' ? 'La session commence.' : `Fin de la conversation :\n${fin}`,
      `Nouvelle demande :\n${demande.slice(0, 2000)}`,
    ].join('\n\n')
    const reponse = await $.model.complete({
      model: 'sonnet',
      system: systeme(await regleModeles($, fichier)),
      prompt,
      effort: 'low',
      maxTokens: 300,
      timeoutMs: 30_000,
    })
    if (!reponse.isAnswered) {
      $.ui.log(`conseil-modele : pas de conseil (${reponse.reason})`)
      return
    }
    const lu = lireReponse(reponse.text)
    if (lu === null) {
      $.ui.log('conseil-modele : réponse illisible, conseil inchangé')
      return
    }
    await update($, conseil, () => lu)
  } finally {
    await update($, enCours, () => false)
  }
}

export const register: Register = (on, options) => {
  const fichier = typeof options?.fichierRegles === 'string' ? options.fichierRegles.trim() : ''

  on('prompt.submit', async ($, e, next) => {
    // Sans écran (un `claude -p` lancé par un script), personne ne lirait le conseil.
    if (ORIGINES_HUMAINES.has(e.origin.kind) && (await $.session.surfaces()).length > 0) {
      const relance = e.text.trim().length < RELANCE_COURTE && (await read($, conseil)) !== null
      if (!relance) {
        // Hors du chemin du prompt : le conseil se calcule pendant que le tour démarre.
        const demande = e.text
        $.clock.after(0, () => void conseiller($, demande, fichier))
      }
    }

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined && e.index === 0) {
      const effort = e.effort === undefined ? null : String(e.effort)
      const avant = await read($, reglage)
      if (avant?.modele !== e.model || avant.effort !== effort) {
        await update($, reglage, () => ({ modele: e.model, effort }))
      }
    }

    return yield* next(e)
  })

  // Le pied du prompt, à côté du sélecteur : le conseil en une étiquette, cochée quand le réglage y
  // est, fléchée dans le sens où bouger l'effort.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const c = await read($, conseil)
    if (c === null) return next(e)
    const ecart = ecartDe(c, await read($, reglage))
    let marque = ''
    if (ecart !== null && ecart.modele === 'garder' && ecart.effort === 0) marque = ' ✓'
    else if (ecart !== null && ecart.effort > 0) marque = ' ↑'
    else if (ecart !== null && ecart.effort < 0) marque = ' ↓'
    const etiquette = `conseil ${c.modele} · ${c.effort}${marque}`

    return next({ ...e, props: { ...e.props, modes: [...e.props.modes, etiquette] } })
  })

  // La mini-fenêtre au-dessus du prompt : permanente dès le premier conseil, recalculée à chaque
  // message de fond ; cochée quand le réglage y est, avec le geste à faire quand il diffère.
  // Changer d'effort en cours de session a gardé le cache 25 fois sur 28 dans nos transcripts
  // (mesuré le 07/10/2026). Changer de modèle a réécrit toute la conversation 33 fois sur 33 :
  // rentable en descendant de Fable, une dépense en montant.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.props.view.agentId !== undefined) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const c = await read($, conseil)
    if (c === null) {
      return (await read($, enCours)) ? <Text dimColor>Conseil modèle : je lis ta demande…</Text> : next(e)
    }
    const r = await read($, reglage)
    const ecart = ecartDe(c, r)
    const gestes = ecart === null ? [] : gestesDe(c, ecart)
    let situation = ''
    if (r !== null && gestes.length === 0) situation = "  ✓ c'est ton réglage"
    else if (r !== null) situation = `  (tu es sur ${nomModele(r.modele)} · ${r.effort ?? '?'})`

    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text bold>
            Conseil : {c.modele} · {c.effort}
          </Text>
          {situation !== '' && <Text dimColor>{situation}</Text>}
        </Box>
        {c.raison !== '' && <Text dimColor>{c.raison}</Text>}
        {gestes.map((geste, i) => (
          <Text key={`geste-${i}`}>{geste}</Text>
        ))}
      </Box>
    )
  })
}
