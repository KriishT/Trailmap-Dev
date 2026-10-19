package main

import (
	"context"
	"net/http"
	"os"

	"github.com/redis/go-redis/v9"
	"github.com/segmentio/kafka-go"
)

func main() {
	brokers := os.Getenv("KAFKA_BROKERS")
	writer := &kafka.Writer{Addr: kafka.TCP(brokers), Topic: "events"}
	reader := kafka.NewReader(kafka.ReaderConfig{Brokers: []string{brokers}, Topic: "commands", GroupID: "notifier"})

	rdb := redis.NewClient(&redis.Options{Addr: os.Getenv("REDIS_URL")})
	rdb.Set(context.Background(), "started", "1", 0)

	_ = writer
	_ = reader
	http.ListenAndServe(":8080", nil)
}
