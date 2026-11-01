package com.nms.backend;

import java.io.IOException;
import java.nio.file.*;
import java.util.*;
import java.util.stream.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "*")
public class ApiController {
    private final EventHub hub;
    @Value("${nms.sim-dir}") private String simDir;
    @Value("${nms.topology-file}") private String topoFile;

    public ApiController(EventHub hub) { this.hub = hub; }

    private ResponseEntity<String> json(String body) {
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(body);
    }

    @GetMapping("/incidents") public ResponseEntity<String> incidents() { return json(hub.incidentsJson()); }
    @GetMapping("/alarms")    public ResponseEntity<String> alarms()    { return json(hub.alarmsJson()); }

    @GetMapping("/topology")
    public ResponseEntity<String> topology() throws IOException {
        return json(Files.readString(Path.of(topoFile)));
    }

    @GetMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter stream() { return hub.subscribe(); }

    // list of devices currently flagged down (simulation state)
    @GetMapping("/sim")
    public ResponseEntity<String> sim() throws IOException {
        try (Stream<Path> s = Files.list(Path.of(simDir))) {
            String body = s.map(p -> p.getFileName().toString())
                .filter(n -> n.endsWith(".down"))
                .map(n -> "\"" + n.substring(0, n.length() - 5) + "\"")
                .collect(Collectors.joining(",", "[", "]"));
            return json(body);
        }
    }

    @PostMapping("/sim/{host}/down")
    public ResponseEntity<Void> down(@PathVariable String host) throws IOException {
        Path p = flag(host);
        if (!Files.exists(p)) Files.createFile(p);
        return ResponseEntity.ok().build();
    }

    @PostMapping("/sim/{host}/up")
    public ResponseEntity<Void> up(@PathVariable String host) throws IOException {
        Files.deleteIfExists(flag(host));
        return ResponseEntity.ok().build();
    }

    private Path flag(String host) {
        if (!host.matches("[A-Za-z0-9_-]+")) throw new IllegalArgumentException("bad host");
        return Path.of(simDir, host + ".down");
    }
}
