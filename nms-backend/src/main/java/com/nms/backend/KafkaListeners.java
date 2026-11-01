package com.nms.backend;

import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

@Component
public class KafkaListeners {
    private final EventHub hub;
    public KafkaListeners(EventHub hub) { this.hub = hub; }

    @KafkaListener(topics = "root-cause-events", groupId = "nms-web")
    public void incident(String msg) { hub.add("incident", msg); }

    @KafkaListener(topics = "raw-alarms", groupId = "nms-web-raw",
                   properties = "auto.offset.reset=latest")
    public void alarm(String msg) { hub.add("alarm", msg); }
}
