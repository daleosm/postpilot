# Free early-warning controls for a facility deployment. These alerts do not
# stop resources or alter IAM; capacity limits and operational response remain
# the hard cost boundary. Billing data is delayed, so alerts are opt-in.
locals {
  cost_alerts_enabled = var.cost_alert_email != null
}

resource "aws_budgets_budget" "postpilot_monthly_cost" {
  count = local.cost_alerts_enabled ? 1 : 0

  name         = "${local.name}-monthly-cost"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_cost_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 50
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.cost_alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.cost_alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.cost_alert_email]
  }
}

resource "aws_ce_anomaly_monitor" "postpilot_services" {
  count = local.cost_alerts_enabled ? 1 : 0

  name              = "${local.name}-aws-services"
  monitor_type      = "DIMENSIONAL"
  monitor_dimension = "SERVICE"
}

resource "aws_ce_anomaly_subscription" "postpilot_services" {
  count = local.cost_alerts_enabled ? 1 : 0

  name             = "${local.name}-cost-anomaly"
  frequency        = "IMMEDIATE"
  monitor_arn_list = [aws_ce_anomaly_monitor.postpilot_services[0].arn]

  subscriber {
    type    = "EMAIL"
    address = var.cost_alert_email
  }

  threshold_expression {
    dimension {
      key           = "ANOMALY_TOTAL_IMPACT_ABSOLUTE"
      values        = [tostring(var.cost_anomaly_threshold_usd)]
      match_options = ["GREATER_THAN_OR_EQUAL"]
    }
  }
}
