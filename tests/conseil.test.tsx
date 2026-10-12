import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { ecartDe, gestesDe, lireReponse, nomModele } from '../hooks/register'

const P = 'conseil-modele'
const SURFACES = ['desktop', 'terminal'] as const
const BANDE = {
  plugin: P,
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: true, maxRows: 12, bodyColumns: 80, scroll: { offset: 0, bodyRows: 11 }, view: {} },
}
const PIED = { plugin: P, component: 'SessionMode' as const, props: { modes: ['focus'] } }
const REPONSE = 'Voici : {"modele":"Fable","effort":"xhigh","raison":"Audit d\'architecture \u2014 long et imbriqué"}'
const CLAUDE_MD = '# Règles\n\n## Modèle\n\nREGLE-TEST : Opus partout.\n\n## Vérifier\n\nautre section'

/** Le monde sous le mod : écran, horloge, fichier de règles, conversation, modèle qui répond `reponse`. */
function monde(
  on: On,
  ecrans: readonly ('desktop' | 'terminal')[] = ['desktop'],
  reponse = REPONSE,
): { clock: MockClock; systemes: string[]; lus: string[] } {
  const clock = mock.clock(on)
  const systemes: string[] = []
  const lus: string[] = []
  on('session.surfaces', () => ({ value: ecrans }))
  on('fs.read', ($, e) => {
    lus.push(e.path)
    return { value: CLAUDE_MD }
  })
  on('session.messages', () => ({ value: [] }))
  on('session.turns', () => ({ value: 0 }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('model.complete', ($, e) => {
    systemes.push(e.system ?? '')
    return {
      value: {
        isAnswered: true as const,
        text: reponse,
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    }
  })
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: null, usage: null }
  })
  // Ce que l'engine dessine sous le mod : les étiquettes du pied, rien dans la bande.
  on('ui.render', { component: 'SessionMode' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="pied">{e.props.modes.join(' & ')}</Text>
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="vide">-</Text>
  })
  return { clock, systemes, lus }
}

async function demander($: Engine, clock: MockClock, text: string, kind: 'sdk' | 'task-notification' = 'sdk') {
  await $.prompt.submit({ text, wait: false, origin: { kind } } as Parameters<Engine['prompt']['submit']>[0])
  for (let i = 0; i < 40; i++) await clock.settle()
}

async function tour($: Engine, model: string, effort: 'medium' | 'high' | 'xhigh' | 'max') {
  const flux = $.turn.step({ turnId: 't', index: 0, model, effort, messageCount: 1 })
  let pas = await flux.next()
  while (pas.done !== true) pas = await flux.next()
}

async function texteDe($: Engine, cible: typeof BANDE | typeof PIED, surface: (typeof SURFACES)[number]) {
  const ui = await $.ui.mount({ ...cible, surface })
  const tout = (await ui.findAll({ type: 'Text' })).map(t => t.text).join(' | ')
  await ui.unmount()
  return tout
}

test('lit la réponse du modèle et refuse ce qui sort de la grille', () => {
  expect(lireReponse(REPONSE)).toEqual({ modele: 'Fable', effort: 'xhigh', raison: "Audit d'architecture, long et imbriqué" })
  // Sonnet et Haiku se lisent : c'est la règle de l'utilisateur qui dit s'il y descend.
  expect(lireReponse('{"modele":"Sonnet","effort":"low","raison":"x"}')).toEqual({ modele: 'Sonnet', effort: 'low', raison: 'x' })
  expect(lireReponse('{"modele":"GPT","effort":"low","raison":"x"}')).toBeNull()
  expect(lireReponse('{"modele":"Opus","effort":"énorme"}')).toBeNull()
  expect(lireReponse('pas de json')).toBeNull()
  expect(nomModele('claude-fable-5-1[1m]')).toBe('Fable')
  expect(nomModele('opusplan')).toBe('Opus')
  const c = { modele: 'Opus' as const, effort: 'high' as const, raison: '' }
  expect(ecartDe(c, null)).toBeNull()
  expect(ecartDe(c, { modele: 'claude-opus-5-5', effort: 'max' })).toEqual({ modele: 'garder', effort: -2 })
  expect(ecartDe(c, { modele: 'claude-fable-5-1', effort: 'medium' })).toEqual({ modele: 'descendre', effort: 1 })
  expect(ecartDe(c, { modele: 'claude-sonnet-5-5', effort: 'high' })).toEqual({ modele: 'monter', effort: 0 })
  expect(gestesDe(c, { modele: 'garder', effort: 0 })).toEqual([])
  expect(gestesDe(c, { modele: 'descendre', effort: 1 })).toEqual([
    'Passe en Opus maintenant : la relecture de la conversation se rembourse dès le prompt suivant.',
    "Monte l'effort à high : changer d'effort ne fait pas relire la conversation.",
  ])
})

test('une demande de fond donne un conseil, lu dans la bande et au pied', { options: { fichierRegles: 'regles.md' } }, async ($, on) => {
  const { clock, systemes } = monde(on)
  await demander($, clock, "Audite toute l'architecture du moteur de prospection et propose un découpage")

  expect(systemes).toHaveLength(1)
  expect(systemes[0]).toContain('REGLE-TEST : Opus partout.')
  expect(systemes[0]).toContain('tu ne conseilles que les modèles qu')
  expect(systemes[0]).not.toContain('jamais Sonnet')
  expect(systemes[0]).not.toContain('autre section')
  for (const surface of SURFACES) {
    expect(await texteDe($, BANDE, surface)).toContain('Conseil : Fable · xhigh')
    expect(await texteDe($, PIED, surface)).toBe('focus & conseil Fable · xhigh')
  }
})

test('une relance courte ou une notification ne relancent pas le conseil', async ($, on) => {
  const { clock, systemes } = monde(on)
  await demander($, clock, "Audite toute l'architecture du moteur de prospection et propose un découpage")
  await demander($, clock, 'oui vas-y')
  await demander($, clock, 'Une tâche de fond vient de finir, voici son long compte rendu complet', 'task-notification')

  expect(systemes).toHaveLength(1)
})

test('sans écran attaché, aucun appel au modèle', async ($, on) => {
  const { clock, systemes } = monde(on, [])
  await demander($, clock, "Audite toute l'architecture du moteur de prospection et propose un découpage")

  expect(systemes).toHaveLength(0)
})

test('la bande reste ouverte, cochée quand le réglage y est, et dit dans quel sens bouger', async ($, on) => {
  const { clock } = monde(on)
  await demander($, clock, "Audite toute l'architecture du moteur de prospection et propose un découpage")

  await tour($, 'claude-fable-5-1', 'xhigh')
  for (const surface of SURFACES) {
    const bande = await texteDe($, BANDE, surface)
    expect(bande).toContain('Conseil : Fable · xhigh')
    expect(bande).toContain("✓ c'est ton réglage")
    expect(bande).not.toContain('Monte')
    expect(bande).not.toContain('Baisse')
    expect(bande).not.toContain('Passe en')
    expect(await texteDe($, PIED, surface)).toBe('focus & conseil Fable · xhigh ✓')
  }

  await tour($, 'claude-fable-5-1', 'high')
  for (const surface of SURFACES) {
    const bande = await texteDe($, BANDE, surface)
    expect(bande).toContain('(tu es sur Fable · high)')
    expect(bande).toContain("Monte l'effort à xhigh")
    expect(bande).not.toContain('Passe en')
    expect(await texteDe($, PIED, surface)).toBe('focus & conseil Fable · xhigh ↑')
  }

  await tour($, 'claude-fable-5-1', 'max')
  expect(await texteDe($, BANDE, 'desktop')).toContain("Baisse l'effort à xhigh")
  expect(await texteDe($, PIED, 'desktop')).toBe('focus & conseil Fable · xhigh ↓')

  await tour($, 'claude-opus-5-5', 'xhigh')
  const monter = await texteDe($, BANDE, 'desktop')
  expect(monter).toContain('(tu es sur Opus · xhigh)')
  expect(monter).toContain('Passe en Fable seulement si la difficulté est réelle')
  expect(monter).not.toContain("l'effort")
})

test('redescendre de Fable à Opus se conseille tout de suite', async ($, on) => {
  const { clock } = monde(on, ['desktop'], '{"modele":"Opus","effort":"high","raison":"Rédaction d un email client"}')
  await demander($, clock, 'Rédige la réponse au mail du client sur le devis, ton habituel')
  await tour($, 'claude-fable-5-1', 'high')

  for (const surface of SURFACES) {
    const bande = await texteDe($, BANDE, surface)
    expect(bande).toContain('Passe en Opus maintenant')
    expect(bande).not.toContain('difficulté')
    expect(bande).not.toContain("l'effort")
  }
})

test('sans fichier de règles, la règle par défaut, et aucun fichier lu', async ($, on) => {
  const { clock, systemes, lus } = monde(on)
  await demander($, clock, "Audite toute l'architecture du moteur de prospection et propose un découpage")

  expect(systemes).toHaveLength(1)
  expect(systemes[0]).toContain('Opus est le modèle de travail')
  expect(systemes[0]).not.toContain('REGLE-TEST')
  expect(lus).toEqual([])
})
