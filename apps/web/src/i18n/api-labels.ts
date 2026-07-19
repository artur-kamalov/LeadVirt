import type { Locale } from "./config";

const activityLabels: Record<Locale, Record<string, string>> = {
  en: {
    "seed.completed": "Demo data prepared",
    "ai.reply": "AI prepared a reply",
    "crm.sent": "Lead sent to CRM",
    "lead.created": "Lead created",
    "lead.updated": "Lead updated",
    "lead.sent_to_crm": "Lead sent to CRM",
    "booking.created": "Booking created",
    "task.created": "Task created",
    "integration.connected": "Integration connected",
    "integration.sample_inbound": "Integration sample received",
    "integration.test_connection": "Integration connection tested",
    "workflow.published": "Workflow published",
    "onboarding.step_completed": "Onboarding step completed",
    "widget.message.received": "Widget message received",
  },
  es: {
    "seed.completed": "Datos de demostración preparados",
    "ai.reply": "La IA preparó una respuesta",
    "crm.sent": "Lead enviado al CRM",
    "lead.created": "Lead creado",
    "lead.updated": "Lead actualizado",
    "lead.sent_to_crm": "Lead enviado al CRM",
    "booking.created": "Reserva creada",
    "task.created": "Tarea creada",
    "integration.connected": "Integración conectada",
    "integration.sample_inbound": "Muestra de integración recibida",
    "integration.test_connection": "Conexión de integración comprobada",
    "workflow.published": "Flujo publicado",
    "onboarding.step_completed": "Paso de incorporación completado",
    "widget.message.received": "Mensaje del widget recibido",
  },
  fr: {
    "seed.completed": "Données de démonstration préparées",
    "ai.reply": "L'IA a préparé une réponse",
    "crm.sent": "Prospect envoyé au CRM",
    "lead.created": "Prospect créé",
    "lead.updated": "Prospect mis à jour",
    "lead.sent_to_crm": "Prospect envoyé au CRM",
    "booking.created": "Réservation créée",
    "task.created": "Tâche créée",
    "integration.connected": "Intégration connectée",
    "integration.sample_inbound": "Exemple d'intégration reçu",
    "integration.test_connection": "Connexion de l'intégration testée",
    "workflow.published": "Scénario publié",
    "onboarding.step_completed": "Étape d'intégration terminée",
    "widget.message.received": "Message du widget reçu",
  },
  de: {
    "seed.completed": "Demodaten vorbereitet",
    "ai.reply": "KI-Antwort vorbereitet",
    "crm.sent": "Lead an CRM gesendet",
    "lead.created": "Lead erstellt",
    "lead.updated": "Lead aktualisiert",
    "lead.sent_to_crm": "Lead an CRM gesendet",
    "booking.created": "Buchung erstellt",
    "task.created": "Aufgabe erstellt",
    "integration.connected": "Integration verbunden",
    "integration.sample_inbound": "Integrationsbeispiel empfangen",
    "integration.test_connection": "Integrationsverbindung getestet",
    "workflow.published": "Workflow veröffentlicht",
    "onboarding.step_completed": "Onboarding-Schritt abgeschlossen",
    "widget.message.received": "Widget-Nachricht empfangen",
  },
  pt: {
    "seed.completed": "Dados de demonstração preparados",
    "ai.reply": "A IA preparou uma resposta",
    "crm.sent": "Lead enviado ao CRM",
    "lead.created": "Lead criado",
    "lead.updated": "Lead atualizado",
    "lead.sent_to_crm": "Lead enviado ao CRM",
    "booking.created": "Reserva criada",
    "task.created": "Tarefa criada",
    "integration.connected": "Integração conectada",
    "integration.sample_inbound": "Amostra da integração recebida",
    "integration.test_connection": "Conexão da integração testada",
    "workflow.published": "Fluxo publicado",
    "onboarding.step_completed": "Etapa de integração concluída",
    "widget.message.received": "Mensagem do widget recebida",
  },
  ru: {
    "seed.completed": "Демо-данные подготовлены",
    "ai.reply": "AI подготовил ответ",
    "crm.sent": "Лид отправлен в CRM",
    "lead.created": "Лид создан",
    "lead.updated": "Лид обновлён",
    "lead.sent_to_crm": "Лид отправлен в CRM",
    "booking.created": "Запись создана",
    "task.created": "Задача создана",
    "integration.connected": "Интеграция подключена",
    "integration.sample_inbound": "Входящий тест интеграции получен",
    "integration.test_connection": "Подключение интеграции проверено",
    "workflow.published": "Сценарий опубликован",
    "onboarding.step_completed": "Шаг онбординга завершён",
    "widget.message.received": "Сообщение из виджета получено",
  },
};

export function dashboardActivityLabel(
  activity: { action: string; title?: string },
  locale: Locale,
) {
  return (
    activityLabels[locale][activity.action] ||
    activity.title ||
    activity.action.replaceAll(".", " ")
  );
}

const analyticsInsightLabels: Record<Locale, Record<string, string>> = {
  en: {
    CHANNEL_VALUE: "Website widget and Telegram generated the most qualified leads this week.",
    HIGH_RISK_HANDOFF: "Route medical and legal questions to a manager before the AI answers.",
    EARLY_BOOKING_TIME:
      "Booking workflows convert better when the AI asks for a preferred time earlier.",
    PRICE_FOLLOWUP: "Follow-up recovers warm leads who disengaged after a pricing question.",
  },
  es: {
    CHANNEL_VALUE: "El widget web y Telegram generaron más leads cualificados esta semana.",
    HIGH_RISK_HANDOFF:
      "Deriva las consultas médicas y legales a un gestor antes de que responda la IA.",
    EARLY_BOOKING_TIME:
      "Los flujos de reserva convierten mejor cuando la IA pregunta antes por la hora preferida.",
    PRICE_FOLLOWUP:
      "El seguimiento recupera leads interesados que se desconectaron tras una pregunta de precio.",
  },
  fr: {
    CHANNEL_VALUE:
      "Le widget du site et Telegram ont généré le plus de prospects qualifiés cette semaine.",
    HIGH_RISK_HANDOFF:
      "Transférez les questions médicales et juridiques à un responsable avant la réponse de l'IA.",
    EARLY_BOOKING_TIME:
      "Les parcours de réservation convertissent mieux quand l'IA demande plus tôt l'horaire souhaité.",
    PRICE_FOLLOWUP:
      "La relance récupère les prospects intéressés partis après une question sur le prix.",
  },
  de: {
    CHANNEL_VALUE:
      "Website-Widget und Telegram lieferten diese Woche die meisten qualifizierten Leads.",
    HIGH_RISK_HANDOFF:
      "Leiten Sie medizinische und rechtliche Fragen vor der KI-Antwort an einen Manager weiter.",
    EARLY_BOOKING_TIME:
      "Buchungsabläufe konvertieren besser, wenn die KI früher nach der Wunschzeit fragt.",
    PRICE_FOLLOWUP:
      "Nachfassaktionen gewinnen warme Leads zurück, die nach einer Preisfrage abgesprungen sind.",
  },
  pt: {
    CHANNEL_VALUE: "O widget do site e o Telegram geraram mais leads qualificados nesta semana.",
    HIGH_RISK_HANDOFF: "Encaminhe dúvidas médicas e jurídicas a um gestor antes da resposta da IA.",
    EARLY_BOOKING_TIME:
      "Fluxos de reserva convertem melhor quando a IA pergunta o horário preferido mais cedo.",
    PRICE_FOLLOWUP:
      "O acompanhamento recupera leads interessados que saíram após uma pergunta de preço.",
  },
  ru: {
    CHANNEL_VALUE: "Виджет сайта и Telegram дали больше всего квалифицированных лидов за неделю.",
    HIGH_RISK_HANDOFF: "Медицинские и юридические вопросы лучше передавать менеджеру до ответа AI.",
    EARLY_BOOKING_TIME: "Сценарии записи работают лучше, когда AI раньше спрашивает удобное время.",
    PRICE_FOLLOWUP: "Follow-up возвращает тёплых лидов, которые ушли после вопроса о цене.",
  },
};

export function analyticsInsightLabel(code: string, locale: Locale) {
  return analyticsInsightLabels[locale][code] || code.replaceAll("_", " ").toLowerCase();
}

const demoWeekdayIndexes: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
  Пн: 0,
  Вт: 1,
  Ср: 2,
  Чт: 3,
  Пт: 4,
  Сб: 5,
  Вс: 6,
};

const demoWeekdayLabels: Record<Locale, readonly string[]> = {
  en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  es: ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"],
  fr: ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."],
  de: ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"],
  pt: ["seg.", "ter.", "qua.", "qui.", "sex.", "sáb.", "dom."],
  ru: ["пн", "вт", "ср", "чт", "пт", "сб", "вс"],
};

const demoScenarioLabels: Record<Locale, Record<string, string>> = {
  en: {
    "Qualification and booking": "Qualification and booking",
    "Lead qualification": "Lead qualification",
    "Manager handoff": "Manager handoff",
    "Send to CRM": "Send to CRM",
    "Follow-up": "Follow-up",
  },
  es: {
    "Qualification and booking": "Calificación y reserva",
    "Lead qualification": "Calificación de leads",
    "Manager handoff": "Transferencia a un responsable",
    "Send to CRM": "Enviar al CRM",
    "Follow-up": "Seguimiento",
  },
  fr: {
    "Qualification and booking": "Qualification et réservation",
    "Lead qualification": "Qualification des prospects",
    "Manager handoff": "Transfert à un responsable",
    "Send to CRM": "Envoi au CRM",
    "Follow-up": "Relance",
  },
  de: {
    "Qualification and booking": "Qualifizierung und Buchung",
    "Lead qualification": "Lead-Qualifizierung",
    "Manager handoff": "Übergabe an einen Manager",
    "Send to CRM": "An CRM senden",
    "Follow-up": "Nachfassen",
  },
  pt: {
    "Qualification and booking": "Qualificação e agendamento",
    "Lead qualification": "Qualificação de leads",
    "Manager handoff": "Transferência para um responsável",
    "Send to CRM": "Enviar ao CRM",
    "Follow-up": "Acompanhamento",
  },
  ru: {
    "Qualification and booking": "Квалификация и запись",
    "Lead qualification": "Квалификация лидов",
    "Manager handoff": "Передача менеджеру",
    "Send to CRM": "Передача в CRM",
    "Follow-up": "Повторный контакт",
  },
};

export function demoAnalyticsWeekdayLabel(value: string, locale: Locale) {
  const index = demoWeekdayIndexes[value];
  return index === undefined ? value : (demoWeekdayLabels[locale][index] ?? value);
}

export function demoAnalyticsScenarioLabel(value: string, locale: Locale) {
  return demoScenarioLabels[locale][value] ?? value;
}
