const en = {
  "dashboard.readiness.title.incomplete": "Get AI ready for customers",
  "dashboard.readiness.title.ready": "AI is ready for customers",
  "dashboard.readiness.description.incomplete":
    "Follow these steps in order. LeadVirt shows only what it can verify.",
  "dashboard.readiness.description.ready":
    "Knowledge, channels, and automatic replies have passed the launch checks.",
  "dashboard.readiness.progress": "{completed} of {total} complete",
  "dashboard.readiness.status.completed": "Complete",
  "dashboard.readiness.status.current": "Next step",
  "dashboard.readiness.status.blocked": "After the previous step",
  "dashboard.readiness.status.needsCheck": "Needs check",
  "dashboard.readiness.step.profile": "Add business information",
  "dashboard.readiness.step.knowledge": "Resolve knowledge issues",
  "dashboard.readiness.step.test": "Test AI answers",
  "dashboard.readiness.step.publish": "Publish knowledge",
  "dashboard.readiness.step.channel": "Connect a customer channel",
  "dashboard.readiness.step.replies": "Enable automatic replies",
  "dashboard.readiness.step.inbound": "Send an inbound test",
  "dashboard.readiness.detail.profileComplete":
    "Customers can receive your business details, services, hours, and rules.",
  "dashboard.readiness.detail.profileMissing":
    "{count} business information sections still need attention.",
  "dashboard.readiness.detail.knowledgeComplete":
    "No blocking knowledge issues need your attention.",
  "dashboard.readiness.detail.knowledgeReview": "{count} items need your decision.",
  "dashboard.readiness.detail.knowledgeBlocked":
    "{count} issues must be resolved before reliable answers can go live.",
  "dashboard.readiness.detail.knowledgeUpdating": "LeadVirt is checking your latest changes.",
  "dashboard.readiness.detail.testComplete": "Answer checks passed for the current knowledge.",
  "dashboard.readiness.detail.testIncomplete":
    "Run the answer checks and resolve any failed result.",
  "dashboard.readiness.detail.publishComplete": "Your latest knowledge is live.",
  "dashboard.readiness.detail.publishIncomplete":
    "The latest approved business knowledge is not live yet.",
  "dashboard.readiness.detail.channelComplete": "A customer channel is connected.",
  "dashboard.readiness.detail.channelIncomplete": "Connect Telegram, your website, or a webhook.",
  "dashboard.readiness.detail.repliesComplete":
    "Automatic replies are active on a connected channel.",
  "dashboard.readiness.detail.repliesIncomplete":
    "Turn on automatic replies after the channel is ready.",
  "dashboard.readiness.detail.inboundComplete": "An inbound message reached LeadVirt successfully.",
  "dashboard.readiness.detail.inboundIncomplete":
    "Send one test message and confirm that it reaches Inbox.",
  "dashboard.readiness.detail.needsCheck":
    "LeadVirt could not verify this step. Open it to check the current state.",
  "dashboard.readiness.action.profile": "Add business information",
  "dashboard.readiness.action.knowledge": "Review knowledge",
  "dashboard.readiness.action.test": "Test answers",
  "dashboard.readiness.action.publish": "Publish knowledge",
  "dashboard.readiness.action.channel": "Connect a channel",
  "dashboard.readiness.action.replies": "Set up replies",
  "dashboard.readiness.action.inbound": "Send a test message",
  "dashboard.readiness.action.ready": "Open Inbox",
  "dashboard.readiness.loading": "Checking launch readiness",
  "dashboard.readiness.error.title": "Launch readiness could not be checked",
  "dashboard.readiness.error.description":
    "LeadVirt could not update these checks. Existing verified results stay visible; try again.",
  "dashboard.readiness.retry": "Check again",
} as const;

export type DashboardReadinessTranslationKey = keyof typeof en;

function translated(overrides: Partial<Record<DashboardReadinessTranslationKey, string>>) {
  return { ...en, ...overrides };
}

export const dashboardReadinessMessages = {
  en,
  ru: translated({
    "dashboard.readiness.title.incomplete": "Подготовьте AI к работе с клиентами",
    "dashboard.readiness.title.ready": "AI готов к работе с клиентами",
    "dashboard.readiness.description.incomplete":
      "Выполняйте шаги по порядку. LeadVirt показывает только подтверждённые результаты.",
    "dashboard.readiness.description.ready":
      "Знания, каналы и автоматические ответы прошли проверку запуска.",
    "dashboard.readiness.progress": "Готово: {completed} из {total}",
    "dashboard.readiness.status.completed": "Готово",
    "dashboard.readiness.status.current": "Следующий шаг",
    "dashboard.readiness.status.blocked": "После предыдущего шага",
    "dashboard.readiness.status.needsCheck": "Нужно проверить",
    "dashboard.readiness.step.profile": "Добавьте информацию о бизнесе",
    "dashboard.readiness.step.knowledge": "Устраните проблемы в знаниях",
    "dashboard.readiness.step.test": "Проверьте ответы AI",
    "dashboard.readiness.step.publish": "Опубликуйте знания",
    "dashboard.readiness.step.channel": "Подключите канал для клиентов",
    "dashboard.readiness.step.replies": "Включите автоматические ответы",
    "dashboard.readiness.step.inbound": "Отправьте входящее тестовое сообщение",
    "dashboard.readiness.detail.profileComplete":
      "AI знает описание бизнеса, услуги, график и правила работы.",
    "dashboard.readiness.detail.profileMissing":
      "Нужно заполнить ещё {count} разделов с информацией о бизнесе.",
    "dashboard.readiness.detail.knowledgeComplete": "Нет проблем, мешающих ответам клиентам.",
    "dashboard.readiness.detail.knowledgeReview": "Нужно принять решение по {count} пунктам.",
    "dashboard.readiness.detail.knowledgeBlocked":
      "Нужно устранить {count} проблем, прежде чем включать ответы клиентам.",
    "dashboard.readiness.detail.knowledgeUpdating": "LeadVirt проверяет последние изменения.",
    "dashboard.readiness.detail.testComplete": "Проверки ответов для текущих знаний пройдены.",
    "dashboard.readiness.detail.testIncomplete":
      "Запустите проверку ответов и исправьте неудачные результаты.",
    "dashboard.readiness.detail.publishComplete": "Последняя версия знаний опубликована.",
    "dashboard.readiness.detail.publishIncomplete":
      "Последняя одобренная версия знаний ещё не опубликована.",
    "dashboard.readiness.detail.channelComplete": "Канал для клиентов подключён.",
    "dashboard.readiness.detail.channelIncomplete":
      "Подключите Telegram, виджет на сайте или webhook.",
    "dashboard.readiness.detail.repliesComplete":
      "Автоматические ответы включены в подключённом канале.",
    "dashboard.readiness.detail.repliesIncomplete":
      "Включите автоматические ответы после подготовки канала.",
    "dashboard.readiness.detail.inboundComplete":
      "Входящее сообщение успешно поступило в LeadVirt.",
    "dashboard.readiness.detail.inboundIncomplete":
      "Отправьте тестовое сообщение и убедитесь, что оно появилось во входящих.",
    "dashboard.readiness.detail.needsCheck":
      "LeadVirt не смог подтвердить этот шаг. Откройте его и проверьте состояние.",
    "dashboard.readiness.action.profile": "Заполнить информацию",
    "dashboard.readiness.action.knowledge": "Проверить знания",
    "dashboard.readiness.action.test": "Проверить ответы",
    "dashboard.readiness.action.publish": "Опубликовать знания",
    "dashboard.readiness.action.channel": "Подключить канал",
    "dashboard.readiness.action.replies": "Настроить ответы",
    "dashboard.readiness.action.inbound": "Отправить тест",
    "dashboard.readiness.action.ready": "Открыть входящие",
    "dashboard.readiness.loading": "Проверяем готовность к запуску",
    "dashboard.readiness.error.title": "Не удалось проверить готовность к запуску",
    "dashboard.readiness.error.description":
      "LeadVirt не смог обновить результаты проверки. Последние подтверждённые данные останутся на экране; повторите попытку.",
    "dashboard.readiness.retry": "Проверить снова",
  }),
  es: translated({
    "dashboard.readiness.title.incomplete": "Prepara la IA para tus clientes",
    "dashboard.readiness.title.ready": "La IA está lista para tus clientes",
    "dashboard.readiness.description.incomplete":
      "Completa los pasos en orden. LeadVirt solo muestra resultados verificados.",
    "dashboard.readiness.description.ready":
      "El conocimiento, los canales y las respuestas automáticas pasaron las comprobaciones.",
    "dashboard.readiness.progress": "{completed} de {total} completados",
    "dashboard.readiness.status.completed": "Completado",
    "dashboard.readiness.status.current": "Siguiente paso",
    "dashboard.readiness.status.blocked": "Después del paso anterior",
    "dashboard.readiness.status.needsCheck": "Requiere revisión",
    "dashboard.readiness.step.profile": "Añade la información del negocio",
    "dashboard.readiness.step.knowledge": "Resuelve los problemas de conocimiento",
    "dashboard.readiness.step.test": "Prueba las respuestas de la IA",
    "dashboard.readiness.step.publish": "Publica el conocimiento",
    "dashboard.readiness.step.channel": "Conecta un canal de clientes",
    "dashboard.readiness.step.replies": "Activa las respuestas automáticas",
    "dashboard.readiness.step.inbound": "Envía una prueba entrante",
    "dashboard.readiness.detail.profileComplete":
      "La IA conoce los datos, servicios, horarios y reglas de tu negocio.",
    "dashboard.readiness.detail.profileMissing":
      "Aún debes completar {count} secciones de información del negocio.",
    "dashboard.readiness.detail.knowledgeComplete":
      "No hay problemas de conocimiento que bloqueen las respuestas.",
    "dashboard.readiness.detail.knowledgeReview":
      "Debes tomar una decisión sobre {count} elementos.",
    "dashboard.readiness.detail.knowledgeBlocked":
      "Resuelve {count} problemas antes de activar respuestas fiables.",
    "dashboard.readiness.detail.knowledgeUpdating":
      "LeadVirt está comprobando los últimos cambios.",
    "dashboard.readiness.detail.testComplete":
      "Las comprobaciones de respuestas pasaron con el conocimiento actual.",
    "dashboard.readiness.detail.testIncomplete":
      "Ejecuta las comprobaciones y corrige los resultados fallidos.",
    "dashboard.readiness.detail.publishComplete": "El conocimiento más reciente está publicado.",
    "dashboard.readiness.detail.publishIncomplete":
      "El conocimiento aprobado más reciente aún no está publicado.",
    "dashboard.readiness.detail.channelComplete": "Hay un canal de clientes conectado.",
    "dashboard.readiness.detail.channelIncomplete": "Conecta Telegram, tu sitio web o un webhook.",
    "dashboard.readiness.detail.repliesComplete":
      "Las respuestas automáticas están activas en un canal conectado.",
    "dashboard.readiness.detail.repliesIncomplete":
      "Activa las respuestas automáticas cuando el canal esté listo.",
    "dashboard.readiness.detail.inboundComplete":
      "Un mensaje entrante llegó correctamente a LeadVirt.",
    "dashboard.readiness.detail.inboundIncomplete":
      "Envía un mensaje de prueba y confirma que aparece en la bandeja de entrada.",
    "dashboard.readiness.detail.needsCheck":
      "LeadVirt no pudo verificar este paso. Ábrelo para comprobar el estado.",
    "dashboard.readiness.action.profile": "Añadir información",
    "dashboard.readiness.action.knowledge": "Revisar conocimiento",
    "dashboard.readiness.action.test": "Probar respuestas",
    "dashboard.readiness.action.publish": "Publicar conocimiento",
    "dashboard.readiness.action.channel": "Conectar un canal",
    "dashboard.readiness.action.replies": "Configurar respuestas",
    "dashboard.readiness.action.inbound": "Enviar una prueba",
    "dashboard.readiness.action.ready": "Abrir bandeja de entrada",
    "dashboard.readiness.loading": "Comprobando la preparación",
    "dashboard.readiness.error.title": "No se pudo comprobar la preparación para el lanzamiento",
    "dashboard.readiness.error.description":
      "LeadVirt no pudo actualizar estas comprobaciones. Los últimos resultados verificados siguen visibles; inténtalo de nuevo.",
    "dashboard.readiness.retry": "Comprobar de nuevo",
  }),
  fr: translated({
    "dashboard.readiness.title.incomplete": "Préparez l’IA pour vos clients",
    "dashboard.readiness.title.ready": "L’IA est prête pour vos clients",
    "dashboard.readiness.description.incomplete":
      "Suivez les étapes dans l’ordre. LeadVirt n’affiche que les résultats vérifiés.",
    "dashboard.readiness.description.ready":
      "Les connaissances, les canaux et les réponses automatiques ont été vérifiés.",
    "dashboard.readiness.progress": "{completed} sur {total} terminées",
    "dashboard.readiness.status.completed": "Terminé",
    "dashboard.readiness.status.current": "Étape suivante",
    "dashboard.readiness.status.blocked": "Après l’étape précédente",
    "dashboard.readiness.status.needsCheck": "À vérifier",
    "dashboard.readiness.step.profile": "Ajoutez les informations de l’entreprise",
    "dashboard.readiness.step.knowledge": "Résolvez les problèmes de connaissances",
    "dashboard.readiness.step.test": "Testez les réponses de l’IA",
    "dashboard.readiness.step.publish": "Publiez les connaissances",
    "dashboard.readiness.step.channel": "Connectez un canal client",
    "dashboard.readiness.step.replies": "Activez les réponses automatiques",
    "dashboard.readiness.step.inbound": "Envoyez un test entrant",
    "dashboard.readiness.detail.profileComplete":
      "L’IA connaît les informations, services, horaires et règles de votre entreprise.",
    "dashboard.readiness.detail.profileMissing":
      "Il reste {count} sections d’informations à compléter.",
    "dashboard.readiness.detail.knowledgeComplete":
      "Aucun problème de connaissances ne bloque les réponses.",
    "dashboard.readiness.detail.knowledgeReview":
      "Vous devez prendre une décision pour {count} éléments.",
    "dashboard.readiness.detail.knowledgeBlocked":
      "Résolvez {count} problèmes avant d’activer des réponses fiables.",
    "dashboard.readiness.detail.knowledgeUpdating": "LeadVirt vérifie vos dernières modifications.",
    "dashboard.readiness.detail.testComplete":
      "Les tests de réponse ont réussi avec les connaissances actuelles.",
    "dashboard.readiness.detail.testIncomplete":
      "Lancez les tests de réponse et corrigez les résultats en échec.",
    "dashboard.readiness.detail.publishComplete":
      "La dernière version des connaissances est publiée.",
    "dashboard.readiness.detail.publishIncomplete":
      "La dernière version approuvée n’est pas encore publiée.",
    "dashboard.readiness.detail.channelComplete": "Un canal client est connecté.",
    "dashboard.readiness.detail.channelIncomplete": "Connectez Telegram, votre site ou un webhook.",
    "dashboard.readiness.detail.repliesComplete":
      "Les réponses automatiques sont actives sur un canal connecté.",
    "dashboard.readiness.detail.repliesIncomplete":
      "Activez les réponses automatiques lorsque le canal est prêt.",
    "dashboard.readiness.detail.inboundComplete": "Un message entrant a bien atteint LeadVirt.",
    "dashboard.readiness.detail.inboundIncomplete":
      "Envoyez un message test et confirmez sa présence dans la boîte de réception.",
    "dashboard.readiness.detail.needsCheck":
      "LeadVirt n’a pas pu vérifier cette étape. Ouvrez-la pour contrôler son état.",
    "dashboard.readiness.action.profile": "Ajouter les informations",
    "dashboard.readiness.action.knowledge": "Vérifier les connaissances",
    "dashboard.readiness.action.test": "Tester les réponses",
    "dashboard.readiness.action.publish": "Publier les connaissances",
    "dashboard.readiness.action.channel": "Connecter un canal",
    "dashboard.readiness.action.replies": "Configurer les réponses",
    "dashboard.readiness.action.inbound": "Envoyer un test",
    "dashboard.readiness.action.ready": "Ouvrir la boîte de réception",
    "dashboard.readiness.loading": "Vérification de la préparation",
    "dashboard.readiness.error.title": "Impossible de vérifier la préparation au lancement",
    "dashboard.readiness.error.description":
      "LeadVirt n’a pas pu actualiser ces vérifications. Les derniers résultats confirmés restent visibles ; réessayez.",
    "dashboard.readiness.retry": "Vérifier à nouveau",
  }),
  de: translated({
    "dashboard.readiness.title.incomplete": "KI für Kunden vorbereiten",
    "dashboard.readiness.title.ready": "Die KI ist für Kunden bereit",
    "dashboard.readiness.description.incomplete":
      "Führen Sie die Schritte der Reihe nach aus. LeadVirt zeigt nur geprüfte Ergebnisse.",
    "dashboard.readiness.description.ready":
      "Wissen, Kanäle und automatische Antworten haben die Prüfungen bestanden.",
    "dashboard.readiness.progress": "{completed} von {total} abgeschlossen",
    "dashboard.readiness.status.completed": "Abgeschlossen",
    "dashboard.readiness.status.current": "Nächster Schritt",
    "dashboard.readiness.status.blocked": "Nach dem vorherigen Schritt",
    "dashboard.readiness.status.needsCheck": "Prüfung erforderlich",
    "dashboard.readiness.step.profile": "Unternehmensinformationen ergänzen",
    "dashboard.readiness.step.knowledge": "Wissensprobleme beheben",
    "dashboard.readiness.step.test": "KI-Antworten testen",
    "dashboard.readiness.step.publish": "Wissen veröffentlichen",
    "dashboard.readiness.step.channel": "Kundenkanal verbinden",
    "dashboard.readiness.step.replies": "Automatische Antworten aktivieren",
    "dashboard.readiness.step.inbound": "Eingangstest senden",
    "dashboard.readiness.detail.profileComplete":
      "Die KI kennt Geschäftsdaten, Leistungen, Öffnungszeiten und Regeln.",
    "dashboard.readiness.detail.profileMissing":
      "{count} Bereiche der Unternehmensinformationen müssen noch ergänzt werden.",
    "dashboard.readiness.detail.knowledgeComplete":
      "Keine Wissensprobleme blockieren die Kundenantworten.",
    "dashboard.readiness.detail.knowledgeReview":
      "Für {count} Einträge ist eine Entscheidung erforderlich.",
    "dashboard.readiness.detail.knowledgeBlocked":
      "Beheben Sie {count} Probleme, bevor zuverlässige Antworten live gehen.",
    "dashboard.readiness.detail.knowledgeUpdating": "LeadVirt prüft die neuesten Änderungen.",
    "dashboard.readiness.detail.testComplete":
      "Die Antwortprüfungen für das aktuelle Wissen waren erfolgreich.",
    "dashboard.readiness.detail.testIncomplete":
      "Führen Sie die Antwortprüfungen aus und beheben Sie Fehler.",
    "dashboard.readiness.detail.publishComplete": "Das neueste Wissen ist veröffentlicht.",
    "dashboard.readiness.detail.publishIncomplete":
      "Das zuletzt freigegebene Wissen ist noch nicht veröffentlicht.",
    "dashboard.readiness.detail.channelComplete": "Ein Kundenkanal ist verbunden.",
    "dashboard.readiness.detail.channelIncomplete":
      "Verbinden Sie Telegram, Ihre Website oder einen Webhook.",
    "dashboard.readiness.detail.repliesComplete":
      "Automatische Antworten sind auf einem verbundenen Kanal aktiv.",
    "dashboard.readiness.detail.repliesIncomplete":
      "Aktivieren Sie automatische Antworten, sobald der Kanal bereit ist.",
    "dashboard.readiness.detail.inboundComplete":
      "Eine eingehende Nachricht hat LeadVirt erfolgreich erreicht.",
    "dashboard.readiness.detail.inboundIncomplete":
      "Senden Sie eine Testnachricht und prüfen Sie den Posteingang.",
    "dashboard.readiness.detail.needsCheck":
      "LeadVirt konnte diesen Schritt nicht prüfen. Öffnen Sie ihn und kontrollieren Sie den Status.",
    "dashboard.readiness.action.profile": "Informationen ergänzen",
    "dashboard.readiness.action.knowledge": "Wissen prüfen",
    "dashboard.readiness.action.test": "Antworten testen",
    "dashboard.readiness.action.publish": "Wissen veröffentlichen",
    "dashboard.readiness.action.channel": "Kanal verbinden",
    "dashboard.readiness.action.replies": "Antworten einrichten",
    "dashboard.readiness.action.inbound": "Test senden",
    "dashboard.readiness.action.ready": "Posteingang öffnen",
    "dashboard.readiness.loading": "Startbereitschaft wird geprüft",
    "dashboard.readiness.error.title": "Die Startbereitschaft konnte nicht geprüft werden",
    "dashboard.readiness.error.description":
      "LeadVirt konnte diese Prüfungen nicht aktualisieren. Die zuletzt bestätigten Ergebnisse bleiben sichtbar; versuchen Sie es erneut.",
    "dashboard.readiness.retry": "Erneut prüfen",
  }),
  pt: translated({
    "dashboard.readiness.title.incomplete": "Prepare a IA para os clientes",
    "dashboard.readiness.title.ready": "A IA está pronta para os clientes",
    "dashboard.readiness.description.incomplete":
      "Siga as etapas em ordem. A LeadVirt mostra apenas resultados verificados.",
    "dashboard.readiness.description.ready":
      "Conhecimento, canais e respostas automáticas passaram nas verificações.",
    "dashboard.readiness.progress": "{completed} de {total} concluídas",
    "dashboard.readiness.status.completed": "Concluído",
    "dashboard.readiness.status.current": "Próxima etapa",
    "dashboard.readiness.status.blocked": "Após a etapa anterior",
    "dashboard.readiness.status.needsCheck": "Precisa verificar",
    "dashboard.readiness.step.profile": "Adicione informações da empresa",
    "dashboard.readiness.step.knowledge": "Resolva problemas no conhecimento",
    "dashboard.readiness.step.test": "Teste as respostas da IA",
    "dashboard.readiness.step.publish": "Publique o conhecimento",
    "dashboard.readiness.step.channel": "Conecte um canal de clientes",
    "dashboard.readiness.step.replies": "Ative respostas automáticas",
    "dashboard.readiness.step.inbound": "Envie um teste de entrada",
    "dashboard.readiness.detail.profileComplete":
      "A IA conhece os dados, serviços, horários e regras da empresa.",
    "dashboard.readiness.detail.profileMissing":
      "Ainda faltam {count} seções de informações da empresa.",
    "dashboard.readiness.detail.knowledgeComplete":
      "Nenhum problema no conhecimento bloqueia as respostas.",
    "dashboard.readiness.detail.knowledgeReview": "Você precisa decidir sobre {count} itens.",
    "dashboard.readiness.detail.knowledgeBlocked":
      "Resolva {count} problemas antes de ativar respostas confiáveis.",
    "dashboard.readiness.detail.knowledgeUpdating":
      "A LeadVirt está verificando as alterações mais recentes.",
    "dashboard.readiness.detail.testComplete":
      "Os testes de resposta passaram com o conhecimento atual.",
    "dashboard.readiness.detail.testIncomplete":
      "Execute os testes de resposta e corrija os resultados com falha.",
    "dashboard.readiness.detail.publishComplete":
      "A versão mais recente do conhecimento está publicada.",
    "dashboard.readiness.detail.publishIncomplete":
      "A versão aprovada mais recente ainda não está publicada.",
    "dashboard.readiness.detail.channelComplete": "Um canal de clientes está conectado.",
    "dashboard.readiness.detail.channelIncomplete": "Conecte o Telegram, seu site ou um webhook.",
    "dashboard.readiness.detail.repliesComplete":
      "As respostas automáticas estão ativas em um canal conectado.",
    "dashboard.readiness.detail.repliesIncomplete":
      "Ative as respostas automáticas quando o canal estiver pronto.",
    "dashboard.readiness.detail.inboundComplete":
      "Uma mensagem de entrada chegou à LeadVirt com sucesso.",
    "dashboard.readiness.detail.inboundIncomplete":
      "Envie uma mensagem de teste e confirme que ela chegou à caixa de entrada.",
    "dashboard.readiness.detail.needsCheck":
      "A LeadVirt não conseguiu verificar esta etapa. Abra-a para conferir o estado.",
    "dashboard.readiness.action.profile": "Adicionar informações",
    "dashboard.readiness.action.knowledge": "Revisar conhecimento",
    "dashboard.readiness.action.test": "Testar respostas",
    "dashboard.readiness.action.publish": "Publicar conhecimento",
    "dashboard.readiness.action.channel": "Conectar um canal",
    "dashboard.readiness.action.replies": "Configurar respostas",
    "dashboard.readiness.action.inbound": "Enviar um teste",
    "dashboard.readiness.action.ready": "Abrir caixa de entrada",
    "dashboard.readiness.loading": "Verificando a preparação",
    "dashboard.readiness.error.title": "Não foi possível verificar a preparação para o lançamento",
    "dashboard.readiness.error.description":
      "A LeadVirt não conseguiu atualizar estas verificações. Os últimos resultados confirmados continuam visíveis; tente novamente.",
    "dashboard.readiness.retry": "Verificar novamente",
  }),
} as const;
