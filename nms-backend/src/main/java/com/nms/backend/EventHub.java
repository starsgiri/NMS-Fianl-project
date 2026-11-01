package com.nms.backend;

import java.util.*;
import java.util.concurrent.*;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@Service
public class EventHub {
    private final Deque<String> incidents = new ConcurrentLinkedDeque<>();
    private final Deque<String> alarms = new ConcurrentLinkedDeque<>();
    private final List<SseEmitter> emitters = new CopyOnWriteArrayList<>();

    public SseEmitter subscribe() {
        SseEmitter e = new SseEmitter(0L);
        emitters.add(e);
        e.onCompletion(() -> emitters.remove(e));
        e.onTimeout(() -> emitters.remove(e));
        e.onError(x -> emitters.remove(e));
        return e;
    }

    public void add(String kind, String json) {
        Deque<String> d = kind.equals("incident") ? incidents : alarms;
        d.addFirst(json);
        while (d.size() > 200) d.removeLast();
        for (SseEmitter e : emitters) {
            try { e.send(SseEmitter.event().name(kind).data(json)); }
            catch (Exception ex) { emitters.remove(e); }
        }
    }

    public String incidentsJson() { return "[" + String.join(",", incidents) + "]"; }
    public String alarmsJson()    { return "[" + String.join(",", alarms) + "]"; }
}
