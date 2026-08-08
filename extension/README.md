# Watch Party · Netflix vinculado

La extensión que hace con Netflix lo que Rave hace en el móvil y Teleparty en
el ordenador: **cada persona reproduce con su propia cuenta**, y la sala manda
play, pausa y posición a todas las pestañas vinculadas a la vez.

Netflix no permite reproducirse dentro de otra web (prohíbe incrustarse y su
DRM solo corre en su reproductor), así que la única vía en un ordenador es
esta: un trozo de código *dentro* de la pestaña de Netflix de cada uno, que
obedece a la sala.

## Instalar (Chrome, Edge, Brave…)

1. Abre `chrome://extensions`.
2. Activa **Modo de desarrollador** (arriba a la derecha).
3. **Cargar descomprimida** → elige esta carpeta (`extension/`).

## Usar

1. Entra en tu sala y abre la app **Netflix**: ahí están el enlace de la sala
   y, si la llevas tú, el **código de mando**.
2. Abre Netflix con tu cuenta y pon la película.
3. Clic en el icono de la extensión → pega el **enlace de la sala** → Vincular.
   - Sin más, tu pestaña **sigue** a la sala.
   - Con el **código de mando**, tu pestaña ES el mando: dar al play en tu
     Netflix mueve el de todos.

## Lo que conviene saber

- Cada persona necesita **su** cuenta de Netflix. La extensión no comparte la
  imagen ni salta el DRM: sincroniza reproductores.
- Solo funciona en navegadores de escritorio con extensiones. En el móvil no
  hay manera desde una web (para eso está la cuenta atrás de la sala); lo que
  hace Rave ahí exige una app nativa.
- Usa la API interna del reproductor de Netflix — la misma que usan todas las
  extensiones de watch party. Netflix puede cambiarla cualquier día; si pasa,
  la extensión deja de mover el player pero la sala y su cuenta atrás siguen.
- El código de mando es tu credencial de moderador en esa sala: no lo pegues
  en el chat.
