terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

provider "aws" {
  region = "us-east-1"
}

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "public_a" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.1.0/24"
  map_public_ip_on_launch = true
}

resource "aws_subnet" "private_a" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.2.0/24"
}

resource "aws_security_group" "web" {
  name   = "web"
  vpc_id = aws_vpc.main.id

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "db" {
  name   = "db"
  vpc_id = aws_vpc.main.id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.web.id]
  }
}

resource "aws_lb" "web" {
  name               = "web"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.web.id]
  subnets            = [aws_subnet.public_a.id]
}

resource "aws_lb_target_group" "api" {
  name     = "api"
  port     = 8080
  protocol = "HTTP"
  vpc_id   = aws_vpc.main.id
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.web.arn
  port              = 443
  protocol          = "HTTPS"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

resource "aws_db_instance" "main" {
  identifier             = "app-db"
  engine                 = "postgres"
  instance_class         = "db.t3.micro"
  publicly_accessible    = false
  vpc_security_group_ids = [aws_security_group.db.id]
}

resource "aws_s3_bucket" "assets" {
  bucket = "acme-assets"
}

resource "aws_sqs_queue" "jobs" {
  name = "jobs"
}

resource "aws_ecs_task_definition" "api" {
  family = "api"
  container_definitions = jsonencode([
    {
      name  = "api"
      image = "acme/api:latest"
      environment = [
        { name = "DB_HOST", value = aws_db_instance.main.address },
        { name = "ASSETS_BUCKET", value = aws_s3_bucket.assets.id },
      ]
    }
  ])
}

resource "aws_ecs_service" "api" {
  name            = "api"
  task_definition = aws_ecs_task_definition.api.arn

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 8080
  }

  network_configuration {
    subnets = [aws_subnet.private_a.id]
  }
}

resource "aws_lambda_function" "worker" {
  function_name = "jobs-worker"
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  role          = "arn:aws:iam::123456789012:role/worker"
}

resource "aws_lambda_event_source_mapping" "jobs" {
  event_source_arn = aws_sqs_queue.jobs.arn
  function_name    = aws_lambda_function.worker.arn
}
