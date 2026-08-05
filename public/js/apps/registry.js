/**
 * The installed apps, in home-screen order.
 *
 * @typedef {object} AppDefinition
 * @property {string} id            unique identifier, also the launch key
 * @property {string} name          full name, shown in Spotlight and the App Store
 * @property {string} [short]       shorter label for the home screen
 * @property {string} [tagline]     one-line description
 * @property {string} icon          glyph name from core/icons.js
 * @property {string} gradient      CSS background for the icon squircle
 * @property {"light"|"dark"} [statusScheme] status-bar colour while running
 * @property {(root: HTMLElement, ctx: object) => ({destroy?: () => void})} mount
 */

import appstore from "./appstore.js"
import calculator from "./calculator.js"
import calendar from "./calendar.js"
import clock from "./clock.js"
import mail from "./mail.js"
import messages from "./messages.js"
import music from "./music.js"
import notes from "./notes.js"
import phone from "./phone.js"
import photos from "./photos.js"
import reminders from "./reminders.js"
import room from "./room.js"
import settings from "./settings.js"
import weather from "./weather.js"

/** Home-screen order; the dock picks its four from this list by id. */
export const APPS = [
  room,
  messages,
  mail,
  photos,
  calendar,
  notes,
  reminders,
  clock,
  weather,
  music,
  calculator,
  appstore,
  phone,
  settings,
]

export default APPS
