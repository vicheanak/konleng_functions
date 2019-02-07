import { Component } from '@angular/core';
import { AngularFirestore, AngularFirestoreCollection } from '@angular/fire/firestore';
import { Observable } from 'rxjs';

export interface Item { name: string; }


@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent {
  title = 'KonlengNg6';
  devices: Observable<any[]>;
  private itemsCollection: AngularFirestoreCollection<Item>;
  items: Observable<Item[]>;

  constructor(db: AngularFirestore) {
  	console.log('hello world');
  	this.itemsCollection = db.collection<Item>('items');
    this.items = this.itemsCollection.valueChanges();
    this.itemsCollection.add({name: 'hello there'});
    
  }



}
