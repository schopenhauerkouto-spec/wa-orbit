# SCHOPENHAUER-WA — Product Specification v2

## Vision
CRM conversationnel WhatsApp centré sur la relation, la mémoire et les suivis contrôlés.

## Cible
Conversation IA contextualisée, mémoire par contact, score d'engagement, température, séquences de follow-up, annulation automatique après réponse, handoff humain, quotas et journalisation.

## États
new, active, waiting, follow_up_due, human_handoff, converted, opt_out, blocked.

## Non-objectifs
Spam massif, contournement des limitations WhatsApp, messages automatiques sans base légitime, secrets dans le frontend.

## Architecture
Transport WhatsApp -> API/webhook -> mémoire contact -> Relationship Engine -> Safety Engine -> IA -> scheduler -> transport.
