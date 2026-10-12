# conseil-modele

Un mod pour Claude Code. À chaque demande de fond, il te dit quel modèle et quel niveau d'effort régler pour la tâche en cours, à la hausse comme à la baisse.

*English below.*

## Ce qu'il affiche

- **Au-dessus du prompt**, en permanence dès le premier conseil : le modèle et l'effort conseillés, la raison en une phrase, et le geste à faire quand ton réglage diffère (« Monte l'effort à high », « Passe en Opus maintenant »). Une coche quand ton réglage y est déjà.
- **Au pied du prompt**, à côté du sélecteur : `conseil Opus · high`, suivi de ✓, ↑ ou ↓.

## Comment il décide

Un petit appel à Sonnet, en effort `low`, lit ta demande et les six derniers messages, puis rend un modèle, un effort et une raison. Il ne se déclenche pas sur une relance de moins de 25 caractères (« oui », « continue »), sur une notification, une tâche planifiée ou un lancement sans écran (`claude -p`).

La grille d'effort qu'il applique :

| Effort | Quand |
|---|---|
| `low` | un geste mécanique ou une question dont la réponse se lit : commit, renommer, lire une valeur, lancer une commande connue |
| `medium` | une tâche claire qui suit une recette connue : éditer un fichier selon une consigne précise, petit script, mise à jour de données |
| `high` | du jugement ou un texte qui sort : copy public, email client, plan, arbitrage, code sur plusieurs fichiers, bug dont la cause est inconnue |
| `xhigh` | un raisonnement long où tout doit se tenir : architecture, audit large, chantier de plusieurs heures, bug qui a résisté |
| `max` | seulement quand l'exactitude prime sur le coût et que `xhigh` n'a pas suffi : décision irréversible, contrat, calcul qui engage de l'argent |

Entre deux niveaux, il prend le plus bas : tu remontes d'un cran si le résultat déçoit.

La règle sur les modèles, par défaut : Opus pour tout le travail, Fable seulement pour un problème difficile annoncé comme tel (il coûte 2,5 fois Opus), jamais moins qu'Opus pour un texte public. Tu peux la remplacer par la tienne (voir Réglage).

## Ce que coûte un changement en cours de session

C'est ce qui rend le conseil utile, alors voici ce qu'on sait, et d'où on le sait.

- **Changer de modèle** fait relire toute la conversation au nouveau modèle, au prix d'écriture du cache. Sur nos transcripts : 33 changements sur 33.
- **Changer d'effort** n'a pas fait relire la conversation 25 fois sur 28 dans nos transcripts. L'API d'Anthropic prévoit deux façons de changer d'effort : changer le réglage global de la requête invalide le cache, alors qu'un changement porté par un message dans la conversation le garde ([doc](https://platform.claude.com/docs/en/build-with-claude/effort)). Notre mesure colle avec la seconde ; c'est une déduction, la doc de Claude Code ne le dit pas.
- **Monter l'effort n'est pas gratuit pour autant** : le modèle réfléchit plus longtemps, donc produit plus de tokens.

D'où les conseils du mod : redescendre de Fable vers Opus tout de suite (la relecture se rembourse en un ou deux prompts), ne monter vers Fable que si la difficulté est réelle, et ajuster l'effort sans hésiter.

## Installation

1. Clone le repo :

   ```bash
   git clone https://github.com/NicoNocturn/conseil-modele.git
   ```

2. Dans `~/.claude/settings.json`, fais pointer Claude Code vers le dossier :

   ```json
   {
     "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/chemin/vers/conseil-modele" }
   }
   ```

3. Ouvre une nouvelle session. Le conseil apparaît à ta première demande de fond.

Pour l'essayer sans toucher à tes réglages : `claude --plugin-dir /chemin/vers/conseil-modele`.

## Réglage

`fichierRegles` : le chemin d'un fichier Markdown dont la section `## Modèle` contient ta propre règle sur les modèles. Le mod la relit à chaque conseil, donc tu la gardes là où tu l'écris déjà (un `CLAUDE.md`, par exemple). Vide, il applique la règle par défaut. Le réglage se change dans `/config`.

### Adapter la règle à ton forfait

La règle par défaut met tout le travail sur Opus. Elle tient sur un gros forfait ; sur un plus petit, elle épuise la semaine avant la fin. Le mod peut conseiller Haiku, Sonnet, Opus ou Fable : c'est ta règle qui dit lesquels il propose. Par exemple :

```markdown
## Modèle

- Sonnet pour les gestes mécaniques et les tâches qui suivent une recette connue.
- Opus dès qu'il faut du jugement ou qu'un texte sort.
- Fable seulement pour un problème vraiment difficile, annoncé comme tel.
```

Choisis le modèle en ouvrant la session, d'après le gros de ce que tu vas y faire, et laisse le mod ajuster l'effort pendant : changer de modèle fait relire toute la conversation, changer d'effort non.

## Tester

```bash
claude plugin validate .
claude plugin test .
```

## English

A Claude Code mod that, on every substantial request, recommends which model and effort level to use for the task at hand, up or down. A small Sonnet call (effort `low`) reads your request and the last six messages, then shows the advice above the prompt with the action to take ("raise effort to high", "switch to Opus now"). The effort grid and the default model rule are in the tables above; point the `fichierRegles` setting at a Markdown file with a `## Modèle` section to use your own rule. In our transcripts, switching models re-read the whole conversation 33 times out of 33, while switching effort kept the cache 25 times out of 28; higher effort still costs more output tokens. Install: clone, then set `CLAUDE_CODE_PLUGIN_DIRS` to the folder in `~/.claude/settings.json`. The interface text is in French.

## Licence

MIT. Écrit par Nicolas Duvillard.
