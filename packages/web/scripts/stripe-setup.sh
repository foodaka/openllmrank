#!/bin/bash
# Configure a Stripe account for openllmrank. Idempotent: safe to re-run.
#
#   STRIPE_API_KEY=sk_test_... packages/web/scripts/stripe-setup.sh            # sandbox / test mode
#   STRIPE_API_KEY=sk_live_... SITE=https://openllmrank.io packages/web/scripts/stripe-setup.sh
#
# What it does on the account behind STRIPE_API_KEY:
#   1. Products + default Prices (USD): "openllmrank tracking" $49/mo,
#      "openllmrank AI-search visibility report" $79 one-time.
#   2. Webhook endpoint at $SITE/api/webhook/stripe subscribed to every event
#      the handler acts on (created if missing, events updated if present).
#      A NEW endpoint prints its signing secret once: put it in
#      STRIPE_WEBHOOK_SECRET on Vercel. An existing endpoint keeps its secret.
#   3. Customer Portal default configuration (cancel at period end, update
#      card, invoice history, privacy/terms links).
# Prints the env values to set at the end. Requires the Stripe CLI.
set -euo pipefail
: "${STRIPE_API_KEY:?set STRIPE_API_KEY}"
SITE="${SITE:-http://localhost:3000}"
export STRIPE_API_KEY
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }

ensure_product() { # name unit_amount interval-or-empty -> price id
  local name="$1" amount="$2" interval="$3" pid price
  pid=$(stripe products search --query "active:'true' AND name:'$name'" | json "d['data'][0]['id'] if d.get('data') else ''")
  if [ -z "$pid" ]; then
    if [ -n "$interval" ]; then
      pid=$(stripe products create --name "$name" -d "default_price_data[currency]=usd" -d "default_price_data[unit_amount]=$amount" -d "default_price_data[recurring][interval]=$interval" -d "metadata[app]=openllmrank" | json "d['id']")
    else
      pid=$(stripe products create --name "$name" -d "default_price_data[currency]=usd" -d "default_price_data[unit_amount]=$amount" -d "metadata[app]=openllmrank" | json "d['id']")
    fi
    echo "created product  $name ($pid)" >&2
  else
    echo "found product    $name ($pid)" >&2
  fi
  price=$(stripe products retrieve "$pid" | json "d.get('default_price') or ''")
  # Prices are immutable: when the configured amount changes, mint a new
  # default price and retire the old one so Checkout picks up the new amount.
  local old_price=""
  if [ -n "$price" ]; then
    local current
    current=$(stripe prices retrieve "$price" | json "d['unit_amount']")
    if [ "$current" != "$amount" ]; then
      echo "repricing        $name: $current -> $amount" >&2
      old_price="$price"; price=""
    fi
  fi
  if [ -z "$price" ]; then
    if [ -n "$interval" ]; then
      price=$(stripe prices create -d "product=$pid" -d "currency=usd" -d "unit_amount=$amount" -d "recurring[interval]=$interval" | json "d['id']")
    else
      price=$(stripe prices create -d "product=$pid" -d "currency=usd" -d "unit_amount=$amount" | json "d['id']")
    fi
    stripe products update "$pid" -d "default_price=$price" >/dev/null
    if [ -n "$old_price" ]; then stripe prices update "$old_price" -d "active=false" >/dev/null; fi
  fi
  stripe prices retrieve "$price" | json "print('  price', d['id'], d['unit_amount'], d['currency'], (d.get('recurring') or {}).get('interval') or 'one-time') or ''" >&2
  echo "$price"
}

SUBSCRIPTION_PRICE_ID=$(ensure_product "openllmrank tracking" 4900 month)
REPORT_PRICE_ID=$(ensure_product "openllmrank AI-search visibility report" 7900 "")

# --- webhook -----------------------------------------------------------------
URL="$SITE/api/webhook/stripe"
EVENTS=(checkout.session.completed customer.subscription.updated customer.subscription.deleted invoice.paid invoice.payment_failed charge.dispute.created payment_intent.payment_failed)
EVENT_ARGS=(); for e in "${EVENTS[@]}"; do EVENT_ARGS+=(-d "enabled_events[]=$e"); done
WE=$(stripe webhook_endpoints list --limit 100 | json "next((w['id'] for w in d['data'] if w['url']=='$URL'), '')")
NEW_SECRET=""
if [ -z "$WE" ]; then
  if [[ "$SITE" == http://localhost* ]]; then
    echo "skipping webhook endpoint for $SITE (use: stripe listen --forward-to localhost:3000/api/webhook/stripe)" >&2
  else
    OUT=$(stripe webhook_endpoints create -d "url=$URL" "${EVENT_ARGS[@]}" -d "description=openllmrank ($SITE)")
    WE=$(echo "$OUT" | json "d['id']"); NEW_SECRET=$(echo "$OUT" | json "d.get('secret','')")
    echo "created webhook  $WE -> $URL" >&2
  fi
else
  stripe webhook_endpoints update "$WE" "${EVENT_ARGS[@]}" >/dev/null
  echo "updated webhook  $WE -> $URL (events: ${EVENTS[*]})" >&2
fi

# --- customer portal ---------------------------------------------------------
PORTAL_ARGS=(
  -d "business_profile[headline]=Manage your openllmrank subscription"
  -d "business_profile[privacy_policy_url]=https://openllmrank.io/privacy"
  -d "business_profile[terms_of_service_url]=https://openllmrank.io/terms"
  -d "features[invoice_history][enabled]=true"
  -d "features[payment_method_update][enabled]=true"
  -d "features[subscription_cancel][enabled]=true"
  -d "features[subscription_cancel][mode]=at_period_end"
  -d "features[customer_update][enabled]=true"
  -d "features[customer_update][allowed_updates][]=email"
  -d "features[customer_update][allowed_updates][]=address"
  -d "default_return_url=$SITE/dashboard/billing"
)
BPC=$(stripe billing_portal configurations list | json "next((c['id'] for c in d['data'] if c['is_default']), '')")
if [ -z "$BPC" ]; then
  BPC=$(stripe billing_portal configurations create "${PORTAL_ARGS[@]}" | json "d['id']"); echo "created portal   $BPC (default)" >&2
else
  stripe billing_portal configurations update "$BPC" "${PORTAL_ARGS[@]}" >/dev/null; echo "updated portal   $BPC (default)" >&2
fi

echo
echo "# Set these on the web app (Vercel) for this Stripe account/mode:"
echo "SUBSCRIPTION_PRICE_ID=$SUBSCRIPTION_PRICE_ID"
echo "REPORT_PRICE_ID=$REPORT_PRICE_ID"
[ -n "$NEW_SECRET" ] && echo "STRIPE_WEBHOOK_SECRET=$NEW_SECRET   # new endpoint; shown once"
exit 0
